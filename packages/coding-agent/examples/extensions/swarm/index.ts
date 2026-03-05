/**
 * Swarm Extension - Multi-Agent Coordination
 *
 * A swarm is a hierarchical group of agents:
 * - Coordinator: interacts with human user, assigns tasks
 * - Workers: specialized agents that do the actual work
 *
 * Communication:
 * - File-based notifications (.pi/team/notifications/)
 * - In-memory wakeup events (events.ts)
 * - Scratchpads for state sharing (.pi/team/context/)
 */

import { complete, getModel, type Message, StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { swarmEvents } from "./events.js";
import * as registry from "./registry.js";
import * as sharedState from "./shared-state.js";

interface ActiveAgent {
	id: string;
	config: registry.AgentConfig;
	status: "idle" | "running" | "waiting" | "complete";
	notificationLine: number;
	task?: string;
	mode: "coordinator" | "worker";
	workerLoop?: () => Promise<void>;
	messages?: Message[];
	abortController?: AbortController;
}

interface SwarmDetails {
	spawned?: string[];
	notified?: string;
	updated?: string;
	agentState?: { id: string; status: string; pending: number; scratchpad: string };
	swarmStatus?: { agents: { id: string; status: string; pending: number }[] };
}

const COORDINATOR_ID = "coordinator";

const SwarmStatusParams = Type.Object({});

const NotifyParams = Type.Object({
	target: Type.String({ description: "Agent ID to notify (or 'all' for broadcast)" }),
	message: Type.String({ description: "Message to send" }),
});

const ReadAgentStateParams = Type.Object({
	agentId: Type.String({ description: "Agent ID to read state from" }),
});

const UpdateStateParams = Type.Object({
	summary: Type.String({ description: "Current status summary" }),
});

const SwarmStartParams = Type.Object({
	agents: Type.Array(Type.String({ description: "Agent name to spawn" }), {
		description: "List of agent names to spawn",
	}),
	task: Type.String({ description: "Initial task for the swarm" }),
	mode: Type.Optional(
		StringEnum(["single", "session-per-agent"] as const, {
			description:
				'Execution mode: "single" = coordinator only calls LLM, workers are handlers. "session-per-agent" = each agent calls LLM concurrently.',
			default: "single",
		}),
	),
	agentScope: Type.Optional(
		StringEnum(["user", "project", "both"] as const, {
			description: 'Which agent directories to use. Default: "user"',
			default: "user",
		}),
	),
});

const activeAgents: Map<string, ActiveAgent> = new Map();
let swarmInitialized = false;
let extensionCtx: ExtensionContext | null = null;

function getActiveAgentIds(): string[] {
	return Array.from(activeAgents.keys());
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("swarm", {
		description: "Start a swarm session with multiple agents",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Swarm requires interactive mode", "error");
				return;
			}

			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /swarm <task>", "error");
				return;
			}

			await sharedState.cleanup(ctx.cwd);
			activeAgents.clear();
			swarmEvents.clearAll();
			swarmInitialized = true;
			extensionCtx = ctx;

			activeAgents.set(COORDINATOR_ID, {
				id: COORDINATOR_ID,
				config: {
					name: "Coordinator",
					description: "Main coordinator agent",
					systemPrompt: "You are the coordinator of a swarm.",
					source: "user",
					filePath: "",
				},
				status: "idle",
				notificationLine: 0,
				mode: "coordinator",
			});

			await sharedState.writeScratchpad(
				ctx.cwd,
				COORDINATOR_ID,
				"Coordinator initialized. Ready to delegate tasks.",
			);

			ctx.ui.notify(`Swarm initialized. Task: ${task}`, "info");
			ctx.ui.setEditorText(task);
		},
	});

	pi.registerTool<typeof SwarmStartParams, SwarmDetails>({
		name: "swarm_start",
		label: "Swarm Start",
		description: [
			"Spawn worker agents for parallel task execution.",
			"Use this to delegate work to specialized agents.",
		].join(" "),
		parameters: SwarmStartParams,

		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<{ content: { type: "text"; text: string }[]; details: SwarmDetails }> {
			const scope = params.agentScope ?? "user";
			const availableAgents = registry.listAgents(ctx.cwd, scope);

			const agentsToSpawn: string[] = [];
			for (const agentName of params.agents) {
				const found = availableAgents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
				if (found) {
					agentsToSpawn.push(found.name);
				}
			}

			if (agentsToSpawn.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No valid agents found. Available: ${availableAgents.map((a) => a.name).join(", ") || "none"}`,
						},
					],
					details: {},
				};
			}

			const executionMode = params.mode ?? "single";
			const defaultModel = getModel("anthropic", "claude-sonnet-4-5");

			for (const agentName of agentsToSpawn) {
				const config = availableAgents.find((a) => a.name === agentName)!;

				const agent: ActiveAgent = {
					id: agentName,
					config,
					status: "idle",
					notificationLine: 0,
					task: params.task,
					mode: executionMode === "session-per-agent" ? "worker" : "worker",
					messages: [],
				};

				activeAgents.set(agentName, agent);

				await sharedState.writeScratchpad(ctx.cwd, agentName, `Initialized. Task: ${params.task}`);

				if (executionMode === "session-per-agent" && defaultModel) {
					agent.abortController = new AbortController();

					agent.workerLoop = async () => {
						const agentMessages: Message[] = [
							{
								role: "user",
								content: [
									{
										type: "text",
										text:
											config.systemPrompt +
											"\n\nYour task: " +
											params.task +
											"\n\nYou will receive notifications from the coordinator. Respond to each with your work.",
									},
								],
								timestamp: Date.now(),
							},
						];

						while (!agent.abortController?.signal.aborted) {
							agent.status = "waiting";

							await new Promise<void>((resolve) => {
								swarmEvents.subscribeWakeup(agentName, () => resolve());
							});

							if (agent.abortController?.signal.aborted) break;

							agent.status = "running";

							const result = await sharedState.readNotifications(ctx.cwd, agentName, agent.notificationLine);
							agent.notificationLine = result.line;

							if (result.notifications.length > 0) {
								const notifText = result.notifications.map((n) => `[From ${n.from}]: ${n.message}`).join("\n");

								agentMessages.push({
									role: "user",
									content: [{ type: "text", text: `Notifications:\n${notifText}` }],
									timestamp: Date.now(),
								});

								try {
									const response = await complete(
										defaultModel,
										{ messages: agentMessages },
										{
											abortSignal: agent.abortController?.signal,
										},
									);

									agentMessages.push(response);

									const responseText = response.content.map((c) => (c.type === "text" ? c.text : "")).join("");

									await sharedState.writeScratchpad(ctx.cwd, agentName, responseText);
									pi.sendUserMessage(`[${agentName}]: ${responseText}`, { deliverAs: "followUp" });
								} catch (err) {
									if (err instanceof Error && err.name === "AbortError") {
										break;
									}
									await sharedState.writeScratchpad(
										ctx.cwd,
										agentName,
										`Error: ${err instanceof Error ? err.message : String(err)}`,
									);
								}
							}

							agent.status = "idle";
						}
					};

					agent.workerLoop().catch((err) => {
						console.error(`[Swarm] Worker ${agentName} error:`, err);
					});
				}

				swarmEvents.subscribeWakeup(agentName, async () => {
					const result = await sharedState.readNotifications(ctx.cwd, agentName, 0);
					for (const notif of result.notifications) {
						pi.sendUserMessage(`[Notification from ${notif.from}]: ${notif.message}`, { deliverAs: "followUp" });
					}
				});
			}

			return {
				content: [
					{
						type: "text",
						text: `Spawned ${agentsToSpawn.length} agent(s): ${agentsToSpawn.join(", ")}`,
					},
				],
				details: { spawned: agentsToSpawn },
			};
		},
	});

	pi.registerTool<typeof NotifyParams, SwarmDetails>({
		name: "notify",
		label: "Notify",
		description: [
			"Send a notification to another agent.",
			"The target agent will be woken up and can respond.",
			"Use 'coordinator' to notify the main agent.",
		].join(" "),
		parameters: NotifyParams,

		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<{ content: { type: "text"; text: string }[]; details: SwarmDetails }> {
			const target = params.target.toLowerCase();
			const from = COORDINATOR_ID;

			if (target === "all") {
				for (const agentId of activeAgents.keys()) {
					if (agentId !== from) {
						await sharedState.appendNotification(ctx.cwd, agentId, from, params.message);
						swarmEvents.emitWakeup(agentId);
					}
				}
				return {
					content: [
						{
							type: "text",
							text: `Broadcast to ${activeAgents.size - 1} agent(s)`,
						},
					],
					details: {},
				};
			}

			const targetAgent = activeAgents.get(target);
			if (!targetAgent) {
				return {
					content: [
						{
							type: "text",
							text: `Unknown agent: ${target}. Active agents: ${Array.from(activeAgents.keys()).join(", ")}`,
						},
					],
					details: {},
				};
			}

			await sharedState.appendNotification(ctx.cwd, target, from, params.message);
			swarmEvents.emitWakeup(target);

			return {
				content: [
					{
						type: "text",
						text: `Notified ${target}: ${params.message}`,
					},
				],
				details: { notified: target },
			};
		},
	});

	pi.registerTool<typeof ReadAgentStateParams, SwarmDetails>({
		name: "read_agent_state",
		label: "Read Agent State",
		description: ["Read another agent's scratchpad summary.", "Use this to check what an agent is working on."].join(
			" ",
		),
		parameters: ReadAgentStateParams,

		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<{ content: { type: "text"; text: string }[]; details: SwarmDetails }> {
			const agentId = params.agentId.toLowerCase();

			const scratchpad = await sharedState.readScratchpad(ctx.cwd, agentId);
			const pending = await sharedState.getNotificationCount(ctx.cwd, agentId);

			if (!scratchpad && pending === 0) {
				return {
					content: [{ type: "text", text: `Agent '${agentId}' not found or has no state.` }],
					details: {},
				};
			}

			const status = activeAgents.get(agentId)?.status || "unknown";

			return {
				content: [
					{
						type: "text",
						text: `## Agent: ${agentId}\n**Status**: ${status}\n**Pending notifications**: ${pending}\n\n### Scratchpad:\n${scratchpad || "(empty)"}`,
					},
				],
				details: { agentState: { id: agentId, status, pending, scratchpad: scratchpad || "" } },
			};
		},
	});

	pi.registerTool<typeof UpdateStateParams, SwarmDetails>({
		name: "update_state",
		label: "Update State",
		description: ["Update your scratchpad with current status.", "Call this at the end of each turn."].join(" "),
		parameters: UpdateStateParams,

		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<{ content: { type: "text"; text: string }[]; details: SwarmDetails }> {
			await sharedState.writeScratchpad(ctx.cwd, COORDINATOR_ID, params.summary);

			return {
				content: [{ type: "text", text: `State updated: ${params.summary}` }],
				details: { updated: params.summary },
			};
		},
	});

	pi.registerTool<typeof SwarmStatusParams, SwarmDetails>({
		name: "swarm_status",
		label: "Swarm Status",
		description: ["Show status of all active agents and pending notifications."].join(" "),
		parameters: SwarmStatusParams,

		async execute(
			_toolCallId,
			_params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<{ content: { type: "text"; text: string }[]; details: SwarmDetails }> {
			const agentIds = getActiveAgentIds();
			const status = await sharedState.getSwarmStatus(ctx.cwd, agentIds);

			if (agentIds.length === 0) {
				return {
					content: [{ type: "text", text: "No active swarm. Use /swarm <task> to start one." }],
					details: {},
				};
			}

			const lines = ["## Swarm Status", ""];
			const statusList: { id: string; status: string; pending: number }[] = [];
			for (const agent of status.agents) {
				const activeAgent = activeAgents.get(agent.id);
				const agentStatus = activeAgent?.status || "unknown";
				lines.push(`- **${agent.id}**: ${agentStatus} | Pending: ${agent.pending}`);
				statusList.push({ id: agent.id, status: agentStatus, pending: agent.pending });
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { swarmStatus: { agents: statusList } },
			};
		},
	});

	pi.on("turn_end", async (_event: TurnEndEvent) => {
		if (!swarmInitialized || !extensionCtx) return;

		const coordinator = activeAgents.get(COORDINATOR_ID);
		if (!coordinator) return;

		const result = await sharedState.readNotifications(
			extensionCtx.cwd,
			COORDINATOR_ID,
			coordinator.notificationLine,
		);
		coordinator.notificationLine = result.line;

		for (const notif of result.notifications) {
			console.log(`[Swarm] Notification from ${notif.from}: ${notif.message}`);
		}
	});
}

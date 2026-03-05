/**
 * Swarm Registry - Agent Discovery Facade
 *
 * Discovers available agents from the filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentConfig {
	name: string;
	description: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
	model?: string;
}

const AGENT_DIR = ".pi/agents";

function getAgentDir(cwd: string, scope: "user" | "project" | "both"): string[] {
	const dirs: string[] = [];

	if (scope === "user" || scope === "both") {
		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		const userAgentDir = path.join(homeDir, AGENT_DIR);
		if (fs.existsSync(userAgentDir)) {
			dirs.push(userAgentDir);
		}
	}

	if (scope === "project" || scope === "both") {
		const projectAgentDir = path.join(cwd, AGENT_DIR);
		if (fs.existsSync(projectAgentDir)) {
			dirs.push(projectAgentDir);
		}
	}

	return dirs;
}

function loadAgentConfig(dirPath: string): AgentConfig | null {
	const agentJsonPath = path.join(dirPath, "agent.json");

	if (!fs.existsSync(agentJsonPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(agentJsonPath, "utf-8");
		const config = JSON.parse(content);

		const systemPromptPath = path.join(dirPath, "system.prompt");
		let systemPrompt = config.systemPrompt || "";
		if (fs.existsSync(systemPromptPath)) {
			systemPrompt = fs.readFileSync(systemPromptPath, "utf-8");
		}

		return {
			name: config.name || path.basename(dirPath),
			description: config.description || "",
			systemPrompt: systemPrompt,
			source: dirPath.includes(process.env.HOME || "") ? "user" : "project",
			filePath: dirPath,
			model: config.model,
		};
	} catch {
		return null;
	}
}

export function listAgents(cwd: string, scope: "user" | "project" | "both" = "user"): AgentConfig[] {
	const agentDirs = getAgentDir(cwd, scope);
	const agents: AgentConfig[] = [];

	for (const dir of agentDirs) {
		if (!fs.existsSync(dir)) continue;

		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const agentDir = path.join(dir, entry.name);
			const config = loadAgentConfig(agentDir);

			if (config) {
				const model = config.model ? ` [model: ${config.model}]` : "";
				config.description = config.description || `Agent ${config.name}${model}`;
				agents.push(config);
			}
		}
	}

	return agents;
}

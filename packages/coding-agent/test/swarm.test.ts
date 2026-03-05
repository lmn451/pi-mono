/**
 * Swarm Extension Tests
 *
 * Phase 1: I/O and State Unit Testing
 * Phase 2: Concurrency & Chaos Testing
 * Phase 3: Mock Agent Integration Testing
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { swarmEvents } from "../examples/extensions/swarm/events.js";
import * as sharedState from "../examples/extensions/swarm/shared-state.js";

const TEMP_DIR_PREFIX = "pi-swarm-test-";

describe("Phase 1: I/O and State Unit Testing", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		swarmEvents.clearAll();
	});

	describe("shared-state.ts - JSONL Append", () => {
		it("should append a single notification to JSONL", async () => {
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Hello");

			const filePath = path.join(tempDir, ".pi/team/notifications/agent1.jsonl");
			expect(fs.existsSync(filePath)).toBe(true);

			const content = fs.readFileSync(filePath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim() !== "");

			expect(lines).toHaveLength(1);
			const parsed = JSON.parse(lines[0]);
			expect(parsed.from).toBe("sender1");
			expect(parsed.message).toBe("Hello");
			expect(parsed.timestamp).toBeDefined();
		});

		it("should append multiple notifications sequentially", async () => {
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Message 1");
			await sharedState.appendNotification(tempDir, "agent1", "sender2", "Message 2");
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Message 3");

			const result = await sharedState.readNotifications(tempDir, "agent1", 0);
			expect(result.notifications).toHaveLength(3);
			expect(result.notifications[0].message).toBe("Message 1");
			expect(result.notifications[1].message).toBe("Message 2");
			expect(result.notifications[2].message).toBe("Message 3");
		});

		it("should read notifications since a specific line", async () => {
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Message 1");
			await sharedState.appendNotification(tempDir, "agent1", "sender2", "Message 2");
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Message 3");

			const result = await sharedState.readNotifications(tempDir, "agent1", 2);
			expect(result.notifications).toHaveLength(1);
			expect(result.notifications[0].message).toBe("Message 3");
		});

		it("should return empty for non-existent agent", async () => {
			const result = await sharedState.readNotifications(tempDir, "nonexistent", 0);
			expect(result.notifications).toHaveLength(0);
			expect(result.line).toBe(0);
		});

		it("should count notifications correctly", async () => {
			await sharedState.appendNotification(tempDir, "agent1", "sender1", "Message 1");
			await sharedState.appendNotification(tempDir, "agent1", "sender2", "Message 2");

			const count = await sharedState.getNotificationCount(tempDir, "agent1");
			expect(count).toBe(2);

			const count2 = await sharedState.getNotificationCount(tempDir, "nonexistent");
			expect(count2).toBe(0);
		});
	});

	describe("shared-state.ts - Scratchpad", () => {
		it("should write and read scratchpad", async () => {
			await sharedState.writeScratchpad(tempDir, "agent1", "# Status\n\nWorking on feature X");

			const content = await sharedState.readScratchpad(tempDir, "agent1");
			expect(content).toBe("# Status\n\nWorking on feature X");
		});

		it("should overwrite scratchpad (not append)", async () => {
			await sharedState.writeScratchpad(tempDir, "agent1", "First summary");
			await sharedState.writeScratchpad(tempDir, "agent1", "Second summary");

			const content = await sharedState.readScratchpad(tempDir, "agent1");
			expect(content).toBe("Second summary");
			expect(content).not.toContain("First summary");
		});

		it("should return empty for non-existent scratchpad", async () => {
			const content = await sharedState.readScratchpad(tempDir, "nonexistent");
			expect(content).toBe("");
		});
	});

	describe("events.ts - Pub/Sub Isolation", () => {
		it("should notify only the subscribed agent", () => {
			let agentACount = 0;
			let agentBCount = 0;

			swarmEvents.subscribeWakeup("agentA", () => {
				agentACount++;
			});
			swarmEvents.subscribeWakeup("agentB", () => {
				agentBCount++;
			});

			swarmEvents.emitWakeup("agentA");

			expect(agentACount).toBe(1);
			expect(agentBCount).toBe(0);
		});

		it("should support multiple subscribers per agent", () => {
			let count1 = 0;
			let count2 = 0;

			swarmEvents.subscribeWakeup("agentA", () => {
				count1++;
			});
			swarmEvents.subscribeWakeup("agentA", () => {
				count2++;
			});

			swarmEvents.emitWakeup("agentA");

			expect(count1).toBe(1);
			expect(count2).toBe(1);
		});

		it("should clear all listeners", () => {
			let count = 0;

			swarmEvents.subscribeWakeup("agentA", () => {
				count++;
			});
			swarmEvents.subscribeWakeup("agentB", () => {
				count++;
			});

			swarmEvents.clearAll();

			swarmEvents.emitWakeup("agentA");
			swarmEvents.emitWakeup("agentB");

			expect(count).toBe(0);
		});

		it("should report correct subscriber count", () => {
			expect(swarmEvents.getSubscriberCount("agentA")).toBe(0);

			swarmEvents.subscribeWakeup("agentA", () => {});
			expect(swarmEvents.getSubscriberCount("agentA")).toBe(1);

			swarmEvents.subscribeWakeup("agentA", () => {});
			expect(swarmEvents.getSubscriberCount("agentA")).toBe(2);

			swarmEvents.clearAll();
			expect(swarmEvents.getSubscriberCount("agentA")).toBe(0);
		});
	});

	describe("shared-state.ts - cleanup", () => {
		it("should clean up old team directory", async () => {
			await sharedState.appendNotification(tempDir, "agent1", "sender", "old message");
			await sharedState.writeScratchpad(tempDir, "agent1", "old state");

			await sharedState.cleanup(tempDir);

			const count = await sharedState.getNotificationCount(tempDir, "agent1");
			expect(count).toBe(0);

			const scratchpad = await sharedState.readScratchpad(tempDir, "agent1");
			expect(scratchpad).toBe("");
		});

		it("should create fresh directories after cleanup", async () => {
			await sharedState.cleanup(tempDir);

			const teamDir = path.join(tempDir, ".pi/team");
			expect(fs.existsSync(teamDir)).toBe(true);
			expect(fs.existsSync(path.join(teamDir, "notifications"))).toBe(true);
			expect(fs.existsSync(path.join(teamDir, "context"))).toBe(true);
		});
	});
});

describe("Phase 2: Concurrency & Chaos Testing", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		swarmEvents.clearAll();
	});

	it("should handle 100 concurrent writes (Thundering Herd)", async () => {
		const promises: Promise<void>[] = [];

		for (let i = 0; i < 100; i++) {
			promises.push(sharedState.appendNotification(tempDir, "coordinator", `agent${i}`, `Message ${i}`));
		}

		await Promise.all(promises);

		const result = await sharedState.readNotifications(tempDir, "coordinator", 0);
		expect(result.notifications).toHaveLength(100);

		const lines = result.notifications.map((n) => n.message).sort();
		for (let i = 0; i < 100; i++) {
			expect(lines).toContain(`Message ${i}`);
		}
	});

	it("should handle rapid fire appends to multiple agents", async () => {
		const agents = ["agentA", "agentB", "agentC"];
		const promises: Promise<void>[] = [];

		for (let i = 0; i < 50; i++) {
			for (const agent of agents) {
				promises.push(sharedState.appendNotification(tempDir, agent, "sender", `Msg ${i}`));
			}
		}

		await Promise.all(promises);

		for (const agent of agents) {
			const count = (await sharedState.readNotifications(tempDir, agent, 0)).notifications.length;
			expect(count).toBe(50);
		}
	});

	it("should maintain consistency under race conditions", async () => {
		const iterations = 20;
		const writesPerIteration = 10;

		for (let iter = 0; iter < iterations; iter++) {
			const promises: Promise<void>[] = [];
			for (let i = 0; i < writesPerIteration; i++) {
				promises.push(sharedState.appendNotification(tempDir, "raceAgent", "sender", `Iter ${iter} Msg ${i}`));
			}
			await Promise.all(promises);
		}

		const result = await sharedState.readNotifications(tempDir, "raceAgent", 0);
		expect(result.notifications).toHaveLength(iterations * writesPerIteration);
	});
});

describe("Phase 3: Mock Agent Integration Testing", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		swarmEvents.clearAll();
	});

	it("should simulate mock coordinator notifying worker", async () => {
		let workerNotified = false;
		swarmEvents.subscribeWakeup("worker", () => {
			workerNotified = true;
		});

		await sharedState.appendNotification(tempDir, "worker", "coordinator", "Do feature X");
		swarmEvents.emitWakeup("worker");

		expect(workerNotified).toBe(true);

		const notifications = await sharedState.readNotifications(tempDir, "worker", 0);
		expect(notifications.notifications).toHaveLength(1);
		expect(notifications.notifications[0].message).toBe("Do feature X");
		expect(notifications.notifications[0].from).toBe("coordinator");
	});

	it("should simulate worker reporting back to coordinator", async () => {
		await sharedState.writeScratchpad(tempDir, "worker", "Status: Working on feature X");

		await sharedState.appendNotification(tempDir, "coordinator", "worker", "Task complete: Feature X implemented");
		swarmEvents.emitWakeup("coordinator");

		const coordinatorNotifications = await sharedState.readNotifications(tempDir, "coordinator", 0);
		expect(coordinatorNotifications.notifications).toHaveLength(1);
		expect(coordinatorNotifications.notifications[0].message).toContain("Task complete");

		const workerScratchpad = await sharedState.readScratchpad(tempDir, "worker");
		expect(workerScratchpad).toBe("Status: Working on feature X");
	});

	it("should simulate broadcast to all agents", async () => {
		const targets = ["worker1", "worker2", "worker3"];
		const notified: string[] = [];

		for (const target of targets) {
			swarmEvents.subscribeWakeup(target, () => {
				notified.push(target);
			});
		}

		for (const target of targets) {
			await sharedState.appendNotification(tempDir, target, "coordinator", "Emergency: Stop work");
			swarmEvents.emitWakeup(target);
		}

		expect(notified).toHaveLength(3);
		expect(notified).toContain("worker1");
		expect(notified).toContain("worker2");
		expect(notified).toContain("worker3");
	});

	it("should handle context request via scratchpad", async () => {
		await sharedState.writeScratchpad(
			tempDir,
			"researcher",
			"# Research Status\n\nFound 3 relevant APIs: Stripe, PayPal, Braintree",
		);

		const context = await sharedState.readScratchpad(tempDir, "researcher");
		expect(context).toContain("Stripe");
		expect(context).toContain("PayPal");
		expect(context).toContain("Braintree");
	});
});

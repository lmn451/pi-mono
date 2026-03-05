/**
 * Swarm Events - Lightweight Pub/Sub for Wakeup Signals
 *
 * This module provides in-memory event signaling only.
 * Data payloads are NOT carried here - they're stored in shared-state.ts
 * for durability and auditability.
 */

import { EventEmitter } from "node:events";

type WakeupCallback = () => void;

class SwarmEventEmitter {
	private emitter: EventEmitter;
	private wakeupCallbacks: Map<string, WakeupCallback[]> = new Map();

	constructor() {
		this.emitter = new EventEmitter();
		this.emitter.setMaxListeners(100);
	}

	emitWakeup(agentId: string): void {
		this.emitter.emit(`wakeup:${agentId}`);
	}

	subscribeWakeup(agentId: string, callback: WakeupCallback): void {
		const callbacks = this.wakeupCallbacks.get(agentId) || [];
		callbacks.push(callback);
		this.wakeupCallbacks.set(agentId, callbacks);

		this.emitter.on(`wakeup:${agentId}`, callback);
	}

	unsubscribeWakeup(agentId: string, callback: WakeupCallback): void {
		const callbacks = this.wakeupCallbacks.get(agentId);
		if (!callbacks) return;

		const index = callbacks.indexOf(callback);
		if (index !== -1) {
			callbacks.splice(index, 1);
		}

		this.emitter.off(`wakeup:${agentId}`, callback);
	}

	clearAll(): void {
		for (const [agentId, callbacks] of this.wakeupCallbacks) {
			for (const callback of callbacks) {
				this.emitter.off(`wakeup:${agentId}`, callback);
			}
		}
		this.wakeupCallbacks.clear();
	}

	hasSubscribers(agentId: string): boolean {
		return this.emitter.listenerCount(`wakeup:${agentId}`) > 0;
	}

	getSubscriberCount(agentId: string): number {
		return this.emitter.listenerCount(`wakeup:${agentId}`);
	}
}

export const swarmEvents = new SwarmEventEmitter();
export type { SwarmEventEmitter };

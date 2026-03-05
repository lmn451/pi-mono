/**
 * Swarm Shared State - Append-only Persistence & Scratchpads
 *
 * Uses JSONL for notifications (append-only, no locking needed)
 * Uses Markdown for scratchpads (lightweight summaries)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Notification {
	timestamp: number;
	from: string;
	message: string;
	type?: "task" | "result" | "broadcast";
}

export interface NotificationReadResult {
	line: number;
	notifications: Notification[];
}

const TEAM_DIR = ".pi/team";
const NOTIFICATIONS_DIR = `${TEAM_DIR}/notifications`;
const CONTEXT_DIR = `${TEAM_DIR}/context`;

function getProjectRoot(cwd: string): string {
	return cwd;
}

function ensureDir(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function getNotificationFile(cwd: string, agentId: string): string {
	const root = getProjectRoot(cwd);
	return path.join(root, NOTIFICATIONS_DIR, `${agentId}.jsonl`);
}

function getScratchpadFile(cwd: string, agentId: string): string {
	const root = getProjectRoot(cwd);
	return path.join(root, CONTEXT_DIR, `${agentId}_scratchpad.md`);
}

export async function appendNotification(cwd: string, targetId: string, from: string, message: string): Promise<void> {
	const filePath = getNotificationFile(cwd, targetId);
	const dirPath = path.dirname(filePath);

	ensureDir(dirPath);

	const entry: Notification = {
		timestamp: Date.now(),
		from,
		message,
	};

	const line = `${JSON.stringify(entry)}\n`;

	await fs.promises.appendFile(filePath, line, "utf-8");
}

export async function readNotifications(
	cwd: string,
	agentId: string,
	sinceLine: number = 0,
): Promise<NotificationReadResult> {
	const filePath = getNotificationFile(cwd, agentId);

	if (!fs.existsSync(filePath)) {
		return { line: 0, notifications: [] };
	}

	const content = await fs.promises.readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim() !== "");

	const notifications: Notification[] = [];
	let currentLine = 0;

	for (const line of lines) {
		currentLine++;
		if (currentLine <= sinceLine) continue;

		try {
			const parsed = JSON.parse(line) as Notification;
			notifications.push(parsed);
		} catch {
			console.warn(`Failed to parse notification line ${currentLine}: ${line}`);
		}
	}

	return { line: currentLine, notifications };
}

export async function getNotificationCount(cwd: string, agentId: string): Promise<number> {
	const filePath = getNotificationFile(cwd, agentId);

	if (!fs.existsSync(filePath)) {
		return 0;
	}

	const content = await fs.promises.readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim() !== "");
	return lines.length;
}

export async function writeScratchpad(cwd: string, agentId: string, summary: string): Promise<void> {
	const filePath = getScratchpadFile(cwd, agentId);
	const dirPath = path.dirname(filePath);

	ensureDir(dirPath);

	await fs.promises.writeFile(filePath, summary, "utf-8");
}

export async function readScratchpad(cwd: string, agentId: string): Promise<string> {
	const filePath = getScratchpadFile(cwd, agentId);

	if (!fs.existsSync(filePath)) {
		return "";
	}

	return fs.promises.readFile(filePath, "utf-8");
}

export async function cleanup(cwd: string): Promise<void> {
	const root = getProjectRoot(cwd);
	const teamDir = path.join(root, TEAM_DIR);

	if (fs.existsSync(teamDir)) {
		await fs.promises.rm(teamDir, { recursive: true, force: true });
	}

	ensureDir(path.join(root, NOTIFICATIONS_DIR));
	ensureDir(path.join(root, CONTEXT_DIR));
}

export async function getSwarmStatus(
	cwd: string,
	agentIds: string[],
): Promise<{
	agents: { id: string; pending: number; scratchpadExists: boolean }[];
}> {
	const agents: { id: string; pending: number; scratchpadExists: boolean }[] = [];

	for (const id of agentIds) {
		const pending = await getNotificationCount(cwd, id);
		const scratchpadExists = fs.existsSync(getScratchpadFile(cwd, id));
		agents.push({ id, pending, scratchpadExists });
	}

	return { agents };
}

export function getTeamDir(cwd: string): string {
	return path.join(getProjectRoot(cwd), TEAM_DIR);
}

export function getNotificationsDir(cwd: string): string {
	return path.join(getProjectRoot(cwd), NOTIFICATIONS_DIR);
}

export function getContextDir(cwd: string): string {
	return path.join(getProjectRoot(cwd), CONTEXT_DIR);
}

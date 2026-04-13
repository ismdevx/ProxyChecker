const fs = require("fs");
const http = require("http");
const path = require("path");
require("colors");
const prompts = require("prompts");
const { checkProxy, getAgent } = require("./Functions/checkProxy");
const {
	SUPPORTED_PROTOCOLS,
	parseProxyLine,
	buildProxyUrl,
	proxyDisplay,
} = require("./Functions/proxyType");

const workspaceRoot = __dirname;
const configPath = path.join(workspaceRoot, "config.json");

let suppressIgnorableWarns = false;

function isIgnorableProxyNetworkError(error) {
	if (!error) {
		return false;
	}

	const knownCodes = new Set([
		"ECONNRESET",
		"ETIMEDOUT",
		"ECONNREFUSED",
		"EHOSTUNREACH",
		"ENETUNREACH",
		"EPROTO",
	]);

	if (error.code && knownCodes.has(error.code)) {
		return true;
	}

	const message = String(error.message || "");
	return message.includes("Client network socket disconnected before secure TLS connection was established");
}

function installRuntimeGuards() {
	process.on("uncaughtException", (error) => {
		if (isIgnorableProxyNetworkError(error)) {
			if (!suppressIgnorableWarns) {
				process.stderr.write(`${"[warn]".yellow} Ignored proxy socket error: ${String(error.message).yellow}\n`);
			}
			return;
		}

		process.stderr.write(`${"[fatal]".red} ${(error && error.stack ? error.stack : String(error)).red}\n`);
		process.exit(1);
	});

	process.on("unhandledRejection", (reason) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		if (isIgnorableProxyNetworkError(error)) {
			if (!suppressIgnorableWarns) {
				process.stderr.write(`${"[warn]".yellow} Ignored proxy rejection: ${String(error.message).yellow}\n`);
			}
			return;
		}

		process.stderr.write(
			`${"[fatal]".red} Unhandled rejection: ${(error && error.stack ? error.stack : String(error)).red}\n`
		);
		process.exit(1);
	});
}

const defaultConfig = {
	inputFile: "proxies.txt",
	outputDir: "Data",
	testUrls: [
		"http://httpbin.org/ip",
		"https://api.ipify.org?format=json",
		"http://ifconfig.me/ip",
		"https://icanhazip.com/",
	],
	timeoutMs: 5000,
	concurrency: 120,
	retryCount: 0,
	maxTestUrlsPerProxy: 2,
	progressEvery: 100,
	logEachResult: false,
	fastThresholdMs: 800,
	maxAliveLatencyMs: 8000,
	maxCheckDurationMs: 10000,
	heartbeatIntervalMs: 2000,
	stallWarnAfterMs: 10000,
	proxyTypesMode: "all",
	selectedProxyTypes: ["http", "https", "socks4", "socks5"],
	tryAllTypesWhenMissingProtocol: true,
	protocolsToTryWhenMissing: ["http", "https", "socks4", "socks5"],
	classifyProxyTypes: true,
};

function normalizeProtocols(list) {
	if (!Array.isArray(list)) {
		return [...SUPPORTED_PROTOCOLS];
	}

	const normalized = list.filter((item) => SUPPORTED_PROTOCOLS.includes(item));
	return normalized.length > 0 ? [...new Set(normalized)] : [...SUPPORTED_PROTOCOLS];
}

function normalizeTestUrls(config) {
	const fromArray = Array.isArray(config.testUrls)
		? config.testUrls.filter(
			(item) => typeof item === "string" && /^https?:\/\//i.test(item.trim())
		)
		: [];

	if (fromArray.length > 0) {
		return fromArray;
	}

	if (typeof config.testUrl === "string" && /^https?:\/\//i.test(config.testUrl.trim())) {
		return [config.testUrl.trim()];
	}

	return [...defaultConfig.testUrls];
}

function loadConfig() {
	const fileConfig = fs.existsSync(configPath)
		? JSON.parse(fs.readFileSync(configPath, "utf8"))
		: {};

	const merged = {
		...defaultConfig,
		...fileConfig,
	};

	merged.timeoutMs = Number(merged.timeoutMs) || defaultConfig.timeoutMs;
	merged.concurrency = Math.max(1, Number(merged.concurrency) || defaultConfig.concurrency);
	merged.retryCount = Math.max(0, Number(merged.retryCount) || 0);
	merged.maxTestUrlsPerProxy = Math.max(
		1,
		Number(merged.maxTestUrlsPerProxy) || defaultConfig.maxTestUrlsPerProxy
	);
	merged.progressEvery = Math.max(1, Number(merged.progressEvery) || defaultConfig.progressEvery);
	merged.logEachResult = Boolean(merged.logEachResult);
	merged.fastThresholdMs = Math.max(1, Number(merged.fastThresholdMs) || defaultConfig.fastThresholdMs);
	merged.maxAliveLatencyMs = Math.max(
		merged.fastThresholdMs,
		Number(merged.maxAliveLatencyMs) || defaultConfig.maxAliveLatencyMs
	);
	merged.maxCheckDurationMs = Math.max(
		merged.timeoutMs,
		Number(merged.maxCheckDurationMs) || defaultConfig.maxCheckDurationMs
	);
	merged.heartbeatIntervalMs = Math.max(
		500,
		Number(merged.heartbeatIntervalMs) || defaultConfig.heartbeatIntervalMs
	);
	merged.stallWarnAfterMs = Math.max(
		merged.heartbeatIntervalMs,
		Number(merged.stallWarnAfterMs) || defaultConfig.stallWarnAfterMs
	);
	merged.proxyTypesMode = ["all", "selected", "prompt"].includes(merged.proxyTypesMode)
		? merged.proxyTypesMode
		: defaultConfig.proxyTypesMode;
	merged.selectedProxyTypes = normalizeProtocols(merged.selectedProxyTypes);
	merged.protocolsToTryWhenMissing = normalizeProtocols(merged.protocolsToTryWhenMissing);
	merged.testUrls = normalizeTestUrls(merged);
	merged.classifyProxyTypes = merged.classifyProxyTypes !== false;

	return merged;
}

async function resolveActiveProxyTypes(config) {
	if (config.proxyTypesMode === "all") {
		return [...SUPPORTED_PROTOCOLS];
	}

	if (config.proxyTypesMode === "selected") {
		return normalizeProtocols(config.selectedProxyTypes);
	}

	const modeAnswer = await prompts(
		{
			type: "select",
			name: "mode",
			message: "Choose proxy types to check",
			choices: [
				{ title: "All proxy types", value: "all" },
				{ title: "Select proxy types", value: "selected" },
			],
			initial: 0,
		},
		{
			onCancel: () => ({ mode: "all" }),
		}
	);

	if (!modeAnswer.mode || modeAnswer.mode === "all") {
		return [...SUPPORTED_PROTOCOLS];
	}

	const selectedAnswer = await prompts(
		{
			type: "multiselect",
			name: "types",
			message: "Select proxy types (SPACE toggle, ENTER confirm)",
			choices: SUPPORTED_PROTOCOLS.map((protocol) => ({
				title: protocol.toUpperCase(),
				value: protocol,
				selected: false,
			})),
			min: 1,
			instructions: true,
		},
		{
			onCancel: () => ({ types: [...SUPPORTED_PROTOCOLS] }),
		}
	);

	return normalizeProtocols(selectedAnswer.types);
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function writeLine(filePath, text) {
	fs.appendFileSync(filePath, `${text}\n`, "utf8");
}

function resetOutputFiles(baseDir) {
	ensureDir(baseDir);

	for (const protocol of SUPPORTED_PROTOCOLS) {
		const typeDir = path.join(baseDir, protocol);
		ensureDir(typeDir);
		fs.writeFileSync(path.join(typeDir, "alive.txt"), "", "utf8");
		fs.writeFileSync(path.join(typeDir, "fast.txt"), "", "utf8");
		fs.writeFileSync(path.join(typeDir, "slow.txt"), "", "utf8");
		fs.writeFileSync(path.join(typeDir, "dead.txt"), "", "utf8");
	}

	fs.writeFileSync(path.join(baseDir, "summary.json"), "", "utf8");
}

function readProxyLines(inputFile) {
	if (!fs.existsSync(inputFile)) {
		throw new Error(`Proxy input file not found: ${inputFile}`);
	}

	const content = fs.readFileSync(inputFile, "utf8");
	return content.split(/\r?\n/);
}

function buildCandidates(parsed, config, activeProtocolsSet) {
	if (parsed.protocol) {
		if (!activeProtocolsSet.has(parsed.protocol)) {
			return [];
		}

		return [
			{
				...parsed,
				protocol: parsed.protocol,
			},
		];
	}

	if (!config.tryAllTypesWhenMissingProtocol) {
		const fallbackProtocol = activeProtocolsSet.has("http")
			? "http"
			: [...activeProtocolsSet][0] || "http";

		return [
			{
				...parsed,
				protocol: fallbackProtocol,
			},
		];
	}

	const protocols = Array.isArray(config.protocolsToTryWhenMissing)
		? config.protocolsToTryWhenMissing.filter((item) => SUPPORTED_PROTOCOLS.includes(item))
		: SUPPORTED_PROTOCOLS;

	return protocols.filter((protocol) => activeProtocolsSet.has(protocol)).map((protocol) => ({
		...parsed,
		protocol,
	}));
}

function uniqueByKey(items, keyFn) {
	const map = new Map();
	for (const item of items) {
		const key = keyFn(item);
		if (!map.has(key)) {
			map.set(key, item);
		}
	}
	return [...map.values()];
}

async function asyncPool(items, limit, worker) {
	const results = new Array(items.length);
	let nextIndex = 0;

	async function runner() {
		while (true) {
			const current = nextIndex;
			nextIndex += 1;

			if (current >= items.length) {
				return;
			}

			results[current] = await worker(items[current], current);
		}
	}

	const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner());
	await Promise.all(runners);
	return results;
}

function withDeadline(promise, timeoutMs) {
	return new Promise((resolve) => {
		let finished = false;
		const timer = setTimeout(() => {
			if (finished) {
				return;
			}
			finished = true;
			resolve({
				ok: false,
				latency: timeoutMs,
				statusCode: null,
				error: "timeout",
			});
		}, timeoutMs);

		promise
			.then((result) => {
				if (finished) {
					return;
				}
				finished = true;
				clearTimeout(timer);
				resolve(result);
			})
			.catch((error) => {
				if (finished) {
					return;
				}
				finished = true;
				clearTimeout(timer);
				resolve({
					ok: false,
					latency: timeoutMs,
					statusCode: null,
					error: error && error.message ? error.message : String(error),
				});
			});
	});
}

function fetchExitIpInfo(candidate, proxyUrlStr, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		let agent;
		try {
			agent = getAgent(candidate.protocol, proxyUrlStr);
		} catch {
			return settle(null);
		}

		const timer = setTimeout(() => settle(null), timeoutMs);

		const req = http.request(
			{
				method: "GET",
				hostname: "ip-api.com",
				path: "/json?fields=query,mobile,hosting",
				port: 80,
				agent,
				headers: {
					"User-Agent": "ProxyChecker/1.0",
					Accept: "application/json",
					Connection: "close",
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => { data += chunk; });
				res.on("end", () => {
					clearTimeout(timer);
					try {
						const parsed = JSON.parse(data);
						if (parsed && typeof parsed.query === "string" && parsed.query.length > 0) {
							settle({ ip: parsed.query, mobile: Boolean(parsed.mobile), hosting: Boolean(parsed.hosting) });
						} else {
							settle(null);
						}
					} catch {
						settle(null);
					}
				});
				res.on("error", () => { clearTimeout(timer); settle(null); });
			}
		);

		req.on("error", () => { clearTimeout(timer); settle(null); });
		req.end();
	});
}

async function classifyAliveProxies(aliveChecks, concurrency, timeoutMs) {
	const breakdown = {
		staticDatacenter: 0,
		staticResidential: 0,
		staticMobile: 0,
		rotatingDatacenter: 0,
		rotatingResidential: 0,
		rotatingMobile: 0,
	};

	if (aliveChecks.length === 0) {
		return breakdown;
	}

	const results = await asyncPool(aliveChecks, concurrency, async (checked) => {
		const info1 = await fetchExitIpInfo(checked.candidate, checked.proxyUrl, timeoutMs);
		if (!info1) return null;

		const info2 = await fetchExitIpInfo(checked.candidate, checked.proxyUrl, timeoutMs);
		const isRotating = Boolean(info2 && info2.ip !== info1.ip);

		return { isRotating, mobile: info1.mobile, hosting: info1.hosting };
	});

	for (const result of results) {
		if (!result) continue;
		const prefix = result.isRotating ? "rotating" : "static";
		if (result.mobile) {
			breakdown[`${prefix}Mobile`] += 1;
		} else if (result.hosting) {
			breakdown[`${prefix}Datacenter`] += 1;
		} else {
			breakdown[`${prefix}Residential`] += 1;
		}
	}

	return breakdown;
}

async function main() {
	const config = loadConfig();
	const activeProxyTypes = await resolveActiveProxyTypes(config);
	const activeProtocolsSet = new Set(activeProxyTypes);
	const inputFile = path.resolve(workspaceRoot, config.inputFile);
	const outputBaseDir = path.resolve(workspaceRoot, config.outputDir);
	const testUrlsForCheck = config.testUrls.slice(0, config.maxTestUrlsPerProxy);

	process.stdout.write(
		`${"[start]".cyan} ${"ProxyChecker".bold} ${`concurrency=${config.concurrency}`.cyan} ${`timeout=${config.timeoutMs}ms`.cyan} ${`maxCheck=${config.maxCheckDurationMs}ms`.cyan} ${`fast<=${config.fastThresholdMs}ms`.cyan} ${`maxAlive<=${config.maxAliveLatencyMs}ms`.cyan} ${`fallbackUrls=${testUrlsForCheck.length}`.cyan} ${`types=${activeProxyTypes.join(",")}`.cyan}\n`
	);

	resetOutputFiles(outputBaseDir);

	const lines = readProxyLines(inputFile);
	const parsedItems = lines.map((line, index) => ({
		lineNumber: index + 1,
		parsed: parseProxyLine(line),
	}));

	const invalids = parsedItems.filter((item) => !item.parsed.ok && item.parsed.reason !== "empty");

	const rawCandidates = parsedItems
		.filter((item) => item.parsed.ok)
		.flatMap((item) =>
			buildCandidates(item.parsed, config, activeProtocolsSet).map((candidate) => ({
				lineNumber: item.lineNumber,
				...candidate,
			}))
		);

	const candidates = uniqueByKey(
		rawCandidates,
		(item) => `${item.protocol}:${item.host}:${item.port}:${item.username || ""}:${item.password || ""}`
	);

	let checkedCount = 0;
	const startedAt = Date.now();

	let runtimeAlive = 0;
	let runtimeDead = 0;
	let inFlight = 0;
	let lastCompletedAt = Date.now();

	const heartbeat = setInterval(() => {
		const now = Date.now();
		const idleFor = now - lastCompletedAt;
		if (checkedCount < candidates.length && idleFor >= config.stallWarnAfterMs) {
			process.stdout.write(
				`${"[wait]".yellow} ${`no completed checks for ${idleFor}ms`.yellow} ${`inFlight=${inFlight}`.yellow} ${`done=${checkedCount}/${candidates.length}`.yellow}\n`
			);
		}
	}, config.heartbeatIntervalMs);

	const checks = await asyncPool(candidates, config.concurrency, async (candidate) => {
		inFlight += 1;
		const proxyUrl = buildProxyUrl(candidate, candidate.protocol);
		let latestResult = null;
		let succeeded = false;
		let forceStop = false;
		const candidateStart = Date.now();

		for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
			for (const testUrl of testUrlsForCheck) {
				const elapsed = Date.now() - candidateStart;
				const remainingBudget = config.maxCheckDurationMs - elapsed;

				if (remainingBudget <= 0) {
					latestResult = {
						ok: false,
						latency: elapsed,
						statusCode: null,
						error: `overall timeout ${config.maxCheckDurationMs}ms`,
					};
					forceStop = true;
					break;
				}

				const requestBudget = Math.min(config.timeoutMs, remainingBudget);
				latestResult = await withDeadline(
					checkProxy({
						proxyProtocol: candidate.protocol,
						proxyUrl,
						testUrl,
						timeoutMs: requestBudget,
					}),
					requestBudget + 250
				);

				if (latestResult.ok) {
					succeeded = true;
					break;
				}
			}

			if (succeeded || forceStop) {
				break;
			}
		}

		if (!latestResult) {
			latestResult = {
				ok: false,
				latency: Date.now() - candidateStart,
				statusCode: null,
				error: "unknown error",
			};
		}

		const isAliveByLatency = Boolean(
			latestResult && latestResult.ok && latestResult.latency <= config.maxAliveLatencyMs
		);

		if (isAliveByLatency) {
			runtimeAlive += 1;
		} else {
			if (latestResult && latestResult.ok && latestResult.latency > config.maxAliveLatencyMs) {
				latestResult.ok = false;
				latestResult.error = `latency ${latestResult.latency}ms exceeds ${config.maxAliveLatencyMs}ms`;
			}
			runtimeDead += 1;
		}

		if (config.logEachResult) {
			const display = proxyDisplay(candidate, candidate.protocol);
			if (latestResult && latestResult.ok) {
				process.stdout.write(
					`${"[alive]".green} ${display.green} ${`${latestResult.latency}ms`.green}\n`
				);
			} else {
				process.stdout.write(
					`${"[dead]".red} ${display.red} ${(latestResult?.error || "unknown error").red}\n`
				);
			}
		}

		checkedCount += 1;
		inFlight -= 1;
		lastCompletedAt = Date.now();
		if (checkedCount % config.progressEvery === 0 || checkedCount === candidates.length) {
			process.stdout.write(
				`${"[progress]".blue} ${`${checkedCount}/${candidates.length}`.bold} ${`alive=${runtimeAlive}`.green} ${`dead=${runtimeDead}`.red}\n`
			);
		}

		return {
			candidate,
			proxyUrl,
			result: latestResult,
		};
	});

	clearInterval(heartbeat);

	const summary = {
		inputLines: lines.length,
		parsedValidLines: parsedItems.filter((item) => item.parsed.ok).length,
		invalidLines: invalids.length,
		testUrlsTried: testUrlsForCheck,
		activeProxyTypes,
		uniqueChecks: candidates.length,
		alive: 0,
		dead: 0,
		fast: 0,
		slow: 0,
		perProtocol: {},
		durationMs: Date.now() - startedAt,
	};

	for (const protocol of SUPPORTED_PROTOCOLS) {
		summary.perProtocol[protocol] = {
			checked: 0,
			alive: 0,
			fast: 0,
			slow: 0,
			dead: 0,
		};
	}

	for (const checked of checks) {
		const protocol = checked.candidate.protocol;
		const typeDir = path.join(outputBaseDir, protocol);
		const outputLine = proxyDisplay(checked.candidate, protocol);

		summary.perProtocol[protocol].checked += 1;

		if (checked.result.ok) {
			summary.alive += 1;
			summary.perProtocol[protocol].alive += 1;
			writeLine(path.join(typeDir, "alive.txt"), outputLine);

			if (checked.result.latency <= config.fastThresholdMs) {
				summary.fast += 1;
				summary.perProtocol[protocol].fast += 1;
				writeLine(path.join(typeDir, "fast.txt"), outputLine);
			} else {
				summary.slow += 1;
				summary.perProtocol[protocol].slow += 1;
				writeLine(path.join(typeDir, "slow.txt"), outputLine);
			}
		} else {
			summary.dead += 1;
			summary.perProtocol[protocol].dead += 1;
			writeLine(
				path.join(typeDir, "dead.txt"),
				`${outputLine} | ${checked.result.error || "unknown error"}`
			);
		}
	}

	fs.writeFileSync(path.join(outputBaseDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

	if (config.classifyProxyTypes) {
		process.stdout.write(`\n${"[classify]".cyan} Classifying alive proxies (static/rotating + type) via ip-api.com...\n`);
		const aliveChecks = checks.filter((c) => c.result && c.result.ok);
		const classifyConcurrency = Math.max(1, Math.min(30, Math.floor(config.concurrency / 4)));
		summary.proxyTypeBreakdown = await classifyAliveProxies(aliveChecks, classifyConcurrency, 10000);
		fs.writeFileSync(path.join(outputBaseDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
	}

	suppressIgnorableWarns = true;
	process.stdout.write(`\n${"[done]".green} ${"Proxy check finished.".green}\n`);
	process.stdout.write(`${"Total checked:".cyan} ${String(summary.uniqueChecks).bold}\n`);
	process.stdout.write(`${"Alive:".green} ${String(summary.alive).green}\n`);
	process.stdout.write(`${"Fast:".green} ${String(summary.fast).green}\n`);
	process.stdout.write(`${"Slow:".yellow} ${String(summary.slow).yellow}\n`);
	process.stdout.write(`${"Dead:".red} ${String(summary.dead).red}\n`);
	if (summary.proxyTypeBreakdown) {
		const b = summary.proxyTypeBreakdown;
		process.stdout.write(`${"Static  — Datacenter:".cyan}  ${String(b.staticDatacenter).cyan}\n`);
		process.stdout.write(`${"Static  — Residential:".cyan} ${String(b.staticResidential).cyan}\n`);
		process.stdout.write(`${"Static  — Mobile:".cyan}      ${String(b.staticMobile).cyan}\n`);
		process.stdout.write(`${"Rotating — Datacenter:".cyan}  ${String(b.rotatingDatacenter).cyan}\n`);
		process.stdout.write(`${"Rotating — Residential:".cyan} ${String(b.rotatingResidential).cyan}\n`);
		process.stdout.write(`${"Rotating — Mobile:".cyan}      ${String(b.rotatingMobile).cyan}\n`);
	}

	resetOutputFiles(outputBaseDir);
	process.exit(0);
}

installRuntimeGuards();

main().catch((error) => {
	process.stderr.write(`${"Failed:".red} ${String(error.message).red}\n`);
	process.exit(1);
});

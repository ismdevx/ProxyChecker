const http = require("http");
const https = require("https");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

function getAgent(proxyProtocol, proxyUrl, targetUrl) {
	if (proxyProtocol === "http") {
		return new HttpProxyAgent(proxyUrl);
	}

	if (proxyProtocol === "https") {
		return new HttpsProxyAgent(proxyUrl);
	}

	if (proxyProtocol === "socks4" || proxyProtocol === "socks5") {
		return new SocksProxyAgent(proxyUrl);
	}

	throw new Error(`Unsupported proxy protocol: ${proxyProtocol}`);
}

function timedRequest(url, agent, timeoutMs) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let req = null;

		const hardTimeout = setTimeout(() => {
			settleReject(new Error("timeout"));
			if (req) {
				req.destroy();
			}
		}, timeoutMs);

		const settleResolve = (value) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(hardTimeout);
			resolve(value);
		};

		const settleReject = (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(hardTimeout);
			reject(error);
		};

		const parsed = new URL(url);
		const client = parsed.protocol === "https:" ? https : http;

		req = client.request(
			{
				method: "GET",
				hostname: parsed.hostname,
				port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
				path: `${parsed.pathname}${parsed.search}`,
				timeout: timeoutMs,
				agent,
				headers: {
					"User-Agent": "ProxyChecker/1.0",
					Accept: "*/*",
					Connection: "close",
				},
			},
			(res) => {
				res.resume();
				res.once("end", () => {
					settleResolve({
						statusCode: res.statusCode,
					});
				});
			}
		);

		req.on("timeout", () => {
			req.destroy(new Error("timeout"));
		});

		req.on("error", (error) => {
			settleReject(error);
		});

		req.on("socket", (socket) => {
			socket.on("error", (error) => {
				settleReject(error);
			});
		});

		if (agent && typeof agent.on === "function") {
			agent.on("error", (error) => {
				settleReject(error);
			});
		}

		req.end();
	});
}

async function checkProxy({ proxyProtocol, proxyUrl, testUrl, timeoutMs }) {
	const started = Date.now();

	try {
		const agent = getAgent(proxyProtocol, proxyUrl, testUrl);
		const result = await timedRequest(testUrl, agent, timeoutMs);
		const latency = Date.now() - started;

		return {
			ok: true,
			latency,
			statusCode: result.statusCode,
			error: null,
		};
	} catch (error) {
		return {
			ok: false,
			latency: Date.now() - started,
			statusCode: null,
			error: error && error.message ? error.message : String(error),
		};
	}
}

module.exports = {
	checkProxy,
	getAgent,
};

const SUPPORTED_PROTOCOLS = ["http", "https", "socks4", "socks5"];

const PROTOCOL_ALIASES = {
	socks: "socks5",
	socks5h: "socks5",
	"socks4a": "socks4",
};

function normalizeProtocol(value) {
	if (!value) {
		return null;
	}

	const lowered = String(value).toLowerCase().trim();
	const normalized = PROTOCOL_ALIASES[lowered] || lowered;
	return SUPPORTED_PROTOCOLS.includes(normalized) ? normalized : null;
}

function stripInlineComment(line) {
	const commentIndex = line.search(/\s[#;].*$/);
	if (commentIndex === -1) {
		return line;
	}
	return line.slice(0, commentIndex);
}

function splitByDelimiter(value, delimiter) {
	if (!value.includes(delimiter)) {
		return [];
	}
	return value.split(delimiter).map((part) => part.trim()).filter(Boolean);
}

function parseHostPort(value) {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const ipv6Match = trimmed.match(/^\[([^\]]+)]:(\d{1,5})$/);
	if (ipv6Match) {
		return {
			host: ipv6Match[1],
			port: Number(ipv6Match[2]),
		};
	}

	const lastColon = trimmed.lastIndexOf(":");
	if (lastColon <= 0 || lastColon === trimmed.length - 1) {
		return null;
	}

	const host = trimmed.slice(0, lastColon).trim();
	const portText = trimmed.slice(lastColon + 1).trim();
	if (!host || !/^\d{1,5}$/.test(portText)) {
		return null;
	}

	return {
		host,
		port: Number(portText),
	};
}

function parseKnownPlainFormats(value) {
	const atParts = splitByDelimiter(value, "@");
	if (atParts.length === 2) {
		const creds = splitByDelimiter(atParts[0], ":");
		const hostPort = parseHostPort(atParts[1]);
		if (hostPort && creds.length >= 2) {
			return {
				host: hostPort.host,
				port: hostPort.port,
				username: creds[0],
				password: creds.slice(1).join(":"),
			};
		}
	}

	const pieces = value.split(":").map((part) => part.trim()).filter(Boolean);

	if (pieces.length === 2) {
		const hostPort = parseHostPort(value);
		if (hostPort) {
			return {
				host: hostPort.host,
				port: hostPort.port,
				username: null,
				password: null,
			};
		}
	}

	if (pieces.length === 4) {
		// Format: host:port:user:pass
		if (/^\d{1,5}$/.test(pieces[1])) {
			return {
				host: pieces[0],
				port: Number(pieces[1]),
				username: pieces[2],
				password: pieces[3],
			};
		}

		// Format: user:pass:host:port
		if (/^\d{1,5}$/.test(pieces[3])) {
			return {
				host: pieces[2],
				port: Number(pieces[3]),
				username: pieces[0],
				password: pieces[1],
			};
		}
	}

	const spaced = value.split(/[\s,;|]+/).map((part) => part.trim()).filter(Boolean);
	if (spaced.length === 4 && /^\d{1,5}$/.test(spaced[1])) {
		// Format: host port user pass
		return {
			host: spaced[0],
			port: Number(spaced[1]),
			username: spaced[2],
			password: spaced[3],
		};
	}

	if (spaced.length === 4 && /^\d{1,5}$/.test(spaced[3])) {
		// Format: user pass host port
		return {
			host: spaced[2],
			port: Number(spaced[3]),
			username: spaced[0],
			password: spaced[1],
		};
	}

	if (spaced.length === 2 && /^\d{1,5}$/.test(spaced[1])) {
		// Format: host port
		return {
			host: spaced[0],
			port: Number(spaced[1]),
			username: null,
			password: null,
		};
	}

	return null;
}

function parseProxyLine(line) {
	const cleaned = stripInlineComment(String(line || "")).trim();
	if (!cleaned) {
		return {
			ok: false,
			reason: "empty",
		};
	}

	let protocol = null;
	let parsed = null;

	if (cleaned.includes("://")) {
		try {
			const url = new URL(cleaned);
			protocol = normalizeProtocol(url.protocol.replace(":", ""));
			if (!protocol) {
				return {
					ok: false,
					reason: "unsupported protocol",
					raw: cleaned,
				};
			}

			parsed = {
				host: url.hostname,
				port: Number(url.port),
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
			};
		} catch (error) {
			return {
				ok: false,
				reason: "invalid url format",
				raw: cleaned,
			};
		}
	} else {
		parsed = parseKnownPlainFormats(cleaned);
		if (!parsed) {
			return {
				ok: false,
				reason: "unsupported plain format",
				raw: cleaned,
			};
		}
	}

	if (!parsed.host || !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
		return {
			ok: false,
			reason: "invalid host or port",
			raw: cleaned,
		};
	}

	return {
		ok: true,
		raw: cleaned,
		protocol,
		host: parsed.host,
		port: parsed.port,
		username: parsed.username,
		password: parsed.password,
	};
}

function buildProxyUrl(proxy, forcedProtocol) {
	const protocol = normalizeProtocol(forcedProtocol || proxy.protocol);
	if (!protocol) {
		throw new Error("Cannot build proxy URL without a supported protocol");
	}

	const auth = proxy.username
		? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@`
		: "";

	return `${protocol}://${auth}${proxy.host}:${proxy.port}`;
}

function proxyDisplay(proxy, protocolOverride) {
	const protocol = protocolOverride || proxy.protocol || "unknown";
	const auth = proxy.username ? `${proxy.username}:${proxy.password || ""}@` : "";
	return `${protocol}://${auth}${proxy.host}:${proxy.port}`;
}

module.exports = {
	SUPPORTED_PROTOCOLS,
	normalizeProtocol,
	parseProxyLine,
	buildProxyUrl,
	proxyDisplay,
};

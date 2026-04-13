# 🔍 ProxyChecker

A fast, concurrent Node.js proxy checker supporting HTTP, HTTPS, SOCKS4, and SOCKS5. Categorizes results by speed, classifies alive proxies as datacenter, residential, or mobile, and outputs a detailed JSON summary.

---

## ✨ Features

- 🌐 Supports all major proxy types: `http`, `https`, `socks4`, `socks5`
- 📄 Accepts mixed proxy formats in a single input file
- 🔎 Auto-detects and tries all proxy types when no protocol is specified
- ⚡ Concurrent checking with configurable concurrency, timeout, and retry
- 📂 Categorizes output per protocol into `alive`, `fast`, `slow`, and `dead`
- 🏷️ Classifies alive proxies by type — **static** vs **rotating** — and by network: **datacenter**, **residential**, **mobile** (via ip-api.com)
- 📊 Writes a detailed run summary to `Data/summary.json`

---

## 📦 Install

```bash
npm install
```

## 🚀 Run

```bash
npm start
```

---

## 📁 Output Structure

```
Data/
  summary.json        ← full run summary with proxy type breakdown
  http/
    alive.txt           ← all working proxies
    fast.txt            ← latency ≤ fastThresholdMs  (e.g. 0ms – 800ms)
    slow.txt            ← latency > fastThresholdMs  (e.g. 801ms – 8000ms)
    dead.txt            ← failed proxies with error reason
  https/
    alive.txt / fast.txt / slow.txt / dead.txt
  socks4/
    alive.txt / fast.txt / slow.txt / dead.txt
  socks5/
    alive.txt / fast.txt / slow.txt / dead.txt
```

**⚡ fast.txt** example:
```
http://1.2.3.4:8080 | 312ms
http://5.6.7.8:3128 | 189ms
```

**🐢 slow.txt** example:
```
http://1.2.3.4:8080 | 2400ms
http://5.6.7.8:3128 | 5100ms
```

### 📋 summary.json example

```json
{
  "alive": 242,
  "dead": 533,
  "fast": 81,
  "slow": 161,
  "proxyTypeBreakdown": {
    "staticDatacenter": 120,
    "staticResidential": 30,
    "staticMobile": 5,
    "rotatingDatacenter": 60,
    "rotatingResidential": 25,
    "rotatingMobile": 2
  },
  "perProtocol": { ... },
  "durationMs": 27821
}
```

---

## 📝 Supported Proxy Formats

Mix any of these in `proxies.txt`:

```
ip:port
ip port
user:pass@ip:port
protocol://ip:port
protocol://user:pass@ip:port
ip:port:user:pass
user:pass:ip:port
host port user pass
user pass host port
```

Accepted protocols: `http`, `https`, `socks4`, `socks5`  
Aliases: `socks` → `socks5`, `socks5h` → `socks5`, `socks4a` → `socks4`

Inline comments with `#` or `;` are supported.

---

## ⚙️ Configuration

Edit `config.json` to override defaults:

| Key | Default | Description |
|-----|---------|-------------|
| `inputFile` | `proxies.txt` | 📄 Path to proxy list |
| `outputDir` | `Data` | 📁 Output directory |
| `testUrls` | see below | 🌐 URLs used to validate proxies |
| `maxTestUrlsPerProxy` | `2` | 🔁 Max test URLs tried per proxy |
| `timeoutMs` | `5000` | ⏱️ Request timeout per check (ms) |
| `maxAliveLatencyMs` | `8000` | 📶 Max latency to consider proxy alive |
| `fastThresholdMs` | `800` | ⚡ Latency threshold for "fast" category |
| `concurrency` | `120` | 🚦 Number of parallel checks |
| `retryCount` | `0` | 🔄 Retries before marking dead |
| `proxyTypesMode` | `all` | 🎛️ `all`, `selected`, or `prompt` |
| `selectedProxyTypes` | all 4 | ✅ Types to check when mode is `selected` |
| `tryAllTypesWhenMissingProtocol` | `true` | 🔍 Try all types when no protocol specified |
| `protocolsToTryWhenMissing` | all 4 | 📋 Protocol order when guessing type |
| `classifyProxyTypes` | `true` | 🏷️ `true` to classify alive proxies via ip-api.com, `false` to skip |

---

## 💡 Example proxies.txt

```
http://127.0.0.1:8080
socks5://user:pass@127.0.0.1:1080
127.0.0.1:3128
user:pass@192.168.0.20:8080
10.0.0.5:1080:myUser:myPass
myUser:myPass:10.0.0.6:1080
```

---

## 💙 Credits

Built by **[ismdevx](https://github.com/ismdevx)**


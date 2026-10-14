/**
 * dsh-feishu, browser half.
 *
 * A compact, draggable Feishu panel in the frame-wide shell.overlay layer. It
 * answers the two questions a person asks while the agent is filing things into
 * their drive - "is it authorized, and as whom" and "what did it just create" -
 * and gives them the one button that fixes the first: the authorization flow.
 *
 * The host half owns every credential; this module only ever sees the sanitized
 * status and activity payloads, and it renders the authorization URL the host
 * already computed rather than assembling one itself.
 *
 * Packaged as a classic ModuleLoader factory with no build step, matching the
 * client-half convention in this ecosystem.
 */
window.__ModuleLoader__.load({
	id: "dsh-feishu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const STATUS_URL = "/api/feishu/status";
		const ACTIVITY_URL = "/api/feishu/activity";
		const LOGOUT_URL = "/api/feishu/oauth/logout";
		const CONFIG_URL = "/api/feishu/config";
		const AUTHORIZE_URL = "/api/feishu/oauth/start";
		const POS_KEY = "dsh-feishu.position";
		const OPEN_KEY = "dsh-feishu.open";
		const WIDTH = 288;
		const ACTIVITY_MS = 5000;
		const STATUS_MS = 30000;

		const STYLE_ID = "dsh-feishu/styles";
		const CSS = [
			".dsh-feishu-root{position:fixed;z-index:60;pointer-events:none;font:12px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}",
			".dsh-feishu-card{pointer-events:auto;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(28,28,36,.96));box-shadow:0 8px 28px rgba(0,0,0,.32);backdrop-filter:blur(12px);overflow:hidden}",
			".dsh-feishu-head{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:grab;user-select:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1))}",
			".dsh-feishu-head:active{cursor:grabbing}",
			".dsh-feishu-title{font-weight:600;color:var(--dsw-alias-label-primary,#e9e9f0);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dsh-feishu-body{padding:9px 10px}",
			".dsh-feishu-row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}",
			".dsh-feishu-k{color:var(--dsw-alias-label-tertiary,#76768a);white-space:nowrap}",
			".dsh-feishu-v{color:var(--dsw-alias-label-secondary,#a8a8b8);text-align:right;word-break:break-all}",
			".dsh-feishu-actions{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}",
			".dsh-feishu-btn{flex:1;min-width:76px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e9e9f0);cursor:pointer;font:inherit;text-align:center}",
			".dsh-feishu-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12))}",
			".dsh-feishu-btn.primary{border-color:var(--dsw-alias-state-business-primary,#4f8cff);color:var(--dsw-alias-state-business-primary,#4f8cff)}",
			".dsh-feishu-btn[disabled]{opacity:.5;cursor:default}",
			".dsh-feishu-dot{width:8px;height:8px;border-radius:50%;flex:none}",
			".dsh-feishu-list{margin-top:9px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));padding-top:7px;max-height:168px;overflow:auto}",
			".dsh-feishu-item{padding:4px 0;border-bottom:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.07))}",
			".dsh-feishu-item:last-child{border-bottom:none}",
			".dsh-feishu-sum{color:var(--dsw-alias-label-secondary,#a8a8b8);word-break:break-word}",
			".dsh-feishu-meta{color:var(--dsw-alias-label-tertiary,#76768a);font-size:11px}",
			".dsh-feishu-hint{color:var(--dsw-alias-label-tertiary,#76768a);font-size:11px;margin-top:6px}",
			".dsh-feishu-link{color:var(--dsw-alias-state-business-primary,#4f8cff);text-decoration:none}",
			".dsh-feishu-link:hover{text-decoration:underline}",
			".dsh-feishu-err{color:var(--dsw-alias-state-danger-primary,#ff7875)}",
			".dsh-feishu-set{display:flex;flex-direction:column;gap:14px;padding:2px 0 20px;max-width:680px}",
			".dsh-feishu-set-hero{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03))}",
			".dsh-feishu-set-hero-main{flex:1;min-width:0}",
			".dsh-feishu-set-hero-title{font-weight:600;color:var(--dsw-alias-label-primary,#e9e9f0)}",
			".dsh-feishu-set-hero-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#76768a);word-break:break-all}",
			".dsh-feishu-set-group{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:10px;padding:10px 12px}",
			".dsh-feishu-set-group>h4{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#76768a);letter-spacing:.02em}",
			".dsh-feishu-set-field{display:grid;grid-template-columns:200px 1fr;gap:10px;align-items:start;padding:6px 0}",
			".dsh-feishu-set-label{color:var(--dsw-alias-label-secondary,#a8a8b8);font-size:12px;padding-top:6px}",
			".dsh-feishu-set-hint{color:var(--dsw-alias-label-tertiary,#76768a);font-size:11px;margin-top:4px}",
			".dsh-feishu-set-input,.dsh-feishu-set-select{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.18));color:var(--dsw-alias-label-primary,#e9e9f0);font:inherit;font-size:12px}",
			".dsh-feishu-set-input:focus,.dsh-feishu-set-select:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4f8cff)}",
			".dsh-feishu-set-check{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary,#e9e9f0);font-size:12px;padding-top:4px}",
			".dsh-feishu-set-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
			".dsh-feishu-set-msg{font-size:12px;padding:7px 10px;border-radius:8px;border:1px solid transparent;word-break:break-word}",
			".dsh-feishu-set-msg.ok{color:var(--dsw-alias-state-success-primary,#3fb950);border-color:var(--dsw-alias-state-success-primary,#3fb950);background:rgba(63,185,80,.08)}",
			".dsh-feishu-set-msg.err{color:var(--dsw-alias-state-danger-primary,#ff7875);border-color:var(--dsw-alias-state-danger-primary,#ff7875);background:rgba(255,120,117,.08)}",
			".dsh-feishu-set-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#a8a8b8);word-break:break-all}",
			".dsh-feishu-set-list{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));padding-top:8px;max-height:200px;overflow:auto}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-feishu";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/**
		 * Read the remembered panel position.
		 * @returns the {x, y} position.
		 */
		function readPosition() {
			try {
				const raw = window.localStorage.getItem(POS_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (typeof parsed.x === "number" && typeof parsed.y === "number") {
						return {
							x: Math.min(Math.max(parsed.x, 0), Math.max(0, window.innerWidth - WIDTH)),
							y: Math.min(Math.max(parsed.y, 0), Math.max(0, window.innerHeight - 60))
						};
					}
				}
			} catch (error) { /* a private-mode failure is not worth surfacing */ }
			return { x: 16, y: Math.max(64, window.innerHeight - 300) };
		}

		/**
		 * Read the remembered collapsed state.
		 * @returns whether the panel is expanded.
		 */
		function readOpen() {
			try {
				const raw = window.localStorage.getItem(OPEN_KEY);
				if (raw === "0") return false;
				if (raw === "1") return true;
			} catch (error) { /* ignore */ }
			return true;
		}

		/**
		 * Format an epoch timestamp as a wall clock time.
		 * @param value - epoch milliseconds.
		 * @returns the formatted time.
		 */
		function clock(value) {
			if (typeof value !== "number") return "";
			const date = new Date(value);
			const pad = (n) => String(n).padStart(2, "0");
			return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
		}

		/**
		 * Fetch a JSON endpoint, tolerating a non-JSON body.
		 * @param url - the endpoint.
		 * @param init - fetch options.
		 * @returns the parsed payload.
		 */
		function getJson(url, init) {
			return fetch(url, { headers: { accept: "application/json" }, ...(init !== undefined ? init : {}) })
				.then((response) => response.json().catch(() => ({ ok: false, message: "invalid JSON from " + url })));
		}

		/**
		 * The Feishu status and activity panel.
		 * @param props - the slot props.
		 * @returns the rendered element.
		 */
		function FeishuPanel(props) {
			const [open, setOpen] = react.useState(readOpen);
			const [pos, setPos] = react.useState(readPosition);
			const [status, setStatus] = react.useState(null);
			const [statusError, setStatusError] = react.useState(null);
			const [activity, setActivity] = react.useState([]);
			const [hidden, setHidden] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const drag = react.useRef(null);
			const statusEpoch = react.useRef(0);

			const loadStatus = react.useCallback(() => {
				const epoch = ++statusEpoch.current;
				return getJson(STATUS_URL).then((payload) => {
					if (epoch !== statusEpoch.current) return;
					if (payload != null && payload.ok === true) {
						setStatus(payload.data);
						setStatusError(null);
						setHidden(payload.data != null && payload.data.enableUi === false);
					} else {
						setStatusError(payload != null && payload.message ? payload.message : "状态读取失败");
					}
				}).catch((error) => {
					if (epoch !== statusEpoch.current) return;
					setStatusError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			const loadActivity = react.useCallback(() => {
				return getJson(ACTIVITY_URL).then((payload) => {
					if (payload != null && payload.ok === true && Array.isArray(payload.data)) {
						setActivity(payload.data.slice(-6).reverse());
					}
				}).catch(() => { /* the transcript remains the authority */ });
			}, []);

			react.useEffect(() => {
				loadStatus();
				loadActivity();
				const statusTimer = window.setInterval(loadStatus, STATUS_MS);
				const activityTimer = window.setInterval(loadActivity, ACTIVITY_MS);
				return () => {
					window.clearInterval(statusTimer);
					window.clearInterval(activityTimer);
				};
			}, [loadStatus, loadActivity]);

			react.useEffect(() => {
				try { window.localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (error) { /* ignore */ }
			}, [pos]);

			react.useEffect(() => {
				try { window.localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (error) { /* ignore */ }
			}, [open]);

			/**
			 * Begin dragging the panel.
			 * @param event - the pointer event.
			 */
			function onPointerDown(event) {
				if (event.button !== 0) return;
				drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
				try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
			}

			/**
			 * Track a drag.
			 * @param event - the pointer event.
			 */
			function onPointerMove(event) {
				if (drag.current === null || drag.current === undefined) return;
				setPos({
					x: Math.min(Math.max(event.clientX - drag.current.dx, 0), Math.max(0, window.innerWidth - WIDTH)),
					y: Math.min(Math.max(event.clientY - drag.current.dy, 0), Math.max(0, window.innerHeight - 40))
				});
			}

			/** End a drag. */
			function onPointerUp() {
				drag.current = null;
			}

			/**
			 * Open the authorization flow in a new tab.
			 */
			function authorize() {
				window.open(AUTHORIZE_URL, "_blank", "noopener,noreferrer");
				window.setTimeout(() => { loadStatus(); }, 4000);
			}

			/** Forget the stored grant. */
			function logout() {
				setBusy(true);
				getJson(LOGOUT_URL, { method: "POST" })
					.then(() => loadStatus())
					.finally(() => setBusy(false));
			}

			/** Refresh both payloads now. */
			function refresh() {
				setBusy(true);
				Promise.all([loadStatus(), loadActivity()]).finally(() => setBusy(false));
			}

			const user = status !== null && status.user !== undefined ? status.user : undefined;
			const authorized = user !== undefined && user.authorized === true;
			const appReady = status !== null && status.appSecretConfigured === true && typeof status.appId === "string" && status.appId.length > 0;
			const dotColor = statusError !== null
				? "var(--dsw-alias-state-danger-primary,#ff7875)"
				: authorized
					? "var(--dsw-alias-state-success-primary,#3fb950)"
					: appReady
						? "var(--dsw-alias-state-warn-primary,#f59e0b)"
						: "var(--dsw-alias-label-tertiary,#76768a)";
			const headline = statusError !== null
				? "飞书：不可用"
				: authorized
					? "飞书：" + (user.name !== undefined ? user.name : "已授权")
					: appReady
						? "飞书：应用身份"
						: "飞书：未配置";

			const rows = [];
			rows.push(react.createElement("div", { className: "dsh-feishu-row", key: "brand" },
				react.createElement("span", { className: "dsh-feishu-k", children: "品牌" }),
				react.createElement("span", { className: "dsh-feishu-v", children: status !== null && status.brandLabel !== undefined ? status.brandLabel : "—" })
			));
			rows.push(react.createElement("div", { className: "dsh-feishu-row", key: "app" },
				react.createElement("span", { className: "dsh-feishu-k", children: "App ID" }),
				react.createElement("span", { className: "dsh-feishu-v", children: status !== null && status.appId ? status.appId : "未配置" })
			));
			rows.push(react.createElement("div", { className: "dsh-feishu-row", key: "secret" },
				react.createElement("span", { className: "dsh-feishu-k", children: "App Secret" }),
				react.createElement("span", { className: "dsh-feishu-v", children: status !== null && status.appSecretConfigured ? (status.appSecretSource !== undefined ? status.appSecretSource : "已配置") : "缺失" })
			));
			rows.push(react.createElement("div", { className: "dsh-feishu-row", key: "user" },
				react.createElement("span", { className: "dsh-feishu-k", children: "用户授权" }),
				react.createElement("span", { className: "dsh-feishu-v", children: authorized ? (user.name !== undefined ? user.name : "已授权") : "未授权" })
			));

			const bodyChildren = [react.createElement("div", { key: "rows" }, rows)];

			if (statusError !== null) {
				bodyChildren.push(react.createElement("div", { className: "dsh-feishu-hint dsh-feishu-err", key: "err", children: statusError }));
			}

			bodyChildren.push(react.createElement("div", { className: "dsh-feishu-actions", key: "actions" },
				react.createElement("button", {
					className: "dsh-feishu-btn primary",
					key: "auth",
					disabled: busy || !appReady,
					title: appReady ? "在新标签页中打开飞书授权页" : "请先配置 appId 与 app secret",
					onClick: authorize,
					children: authorized ? "重新授权" : "授权飞书"
				}),
				react.createElement("button", { className: "dsh-feishu-btn", key: "refresh", disabled: busy, onClick: refresh, children: "刷新" }),
				react.createElement("button", { className: "dsh-feishu-btn", key: "logout", disabled: busy || !authorized, onClick: logout, children: "解除授权" })
			));

			if (activity.length > 0) {
				const items = activity.map((entry) => react.createElement("div", { className: "dsh-feishu-item", key: String(entry.seq) },
					react.createElement("div", { className: entry.ok === false ? "dsh-feishu-sum dsh-feishu-err" : "dsh-feishu-sum" },
						entry.url !== undefined && entry.url.length > 0
							? react.createElement("a", { className: "dsh-feishu-link", href: entry.url, target: "_blank", rel: "noreferrer", children: entry.summary })
							: entry.summary
					),
					react.createElement("div", { className: "dsh-feishu-meta", children: clock(entry.at) + " · " + entry.tool + (entry.identity !== undefined ? " · " + entry.identity : "") })
				));
				bodyChildren.push(react.createElement("div", { className: "dsh-feishu-list", key: "list" }, items));
				bodyChildren.push(react.createElement("div", { className: "dsh-feishu-hint", key: "hint", children: "最近创建与修改的飞书对象" }));
			} else {
				bodyChildren.push(react.createElement("div", { className: "dsh-feishu-hint", key: "hint", children: "尚无飞书操作记录" }));
			}

			const card = react.createElement("div", { className: "dsh-feishu-card" },
				react.createElement("div", {
					className: "dsh-feishu-head",
					onPointerDown: onPointerDown,
					onPointerMove: onPointerMove,
					onPointerUp: onPointerUp,
					onClick: () => setOpen((value) => !value)
				},
					react.createElement("span", { className: "dsh-feishu-dot", style: { background: dotColor } }),
					react.createElement("span", { className: "dsh-feishu-title", children: open ? "飞书 / Lark" : headline }),
					react.createElement("span", { className: "dsh-feishu-meta", children: open ? "−" : "+" })
				),
				open ? react.createElement("div", { className: "dsh-feishu-body" }, bodyChildren) : null
			);

			if (hidden) return null;
			return react.createElement("div", { className: "dsh-feishu-root", style: { left: pos.x + "px", top: pos.y + "px", width: WIDTH + "px" } }, card);
		}

		/**
		 * The field plan the settings page renders.
		 *
		 * The host validates every field it accepts; this plan only decides how a
		 * field is presented. A key the host does not accept is rejected on save
		 * with the host's own message, so the two cannot silently disagree.
		 */
		const SETTINGS_GROUPS = [
			{
				title: "应用凭据",
				fields: [
					{ key: "appId", type: "text", label: "App ID", hint: "飞书开放平台 → 凭证与基础信息。留空则插件不可用。" },
					{ key: "@appSecret", type: "password", label: "App Secret", hint: "只写入凭据库，不会出现在配置文件里，也不会回显。留空表示不修改。" },
					{ key: "appSecretRef", type: "text", label: "凭据引用名", hint: "凭据库中的键名，默认 FEISHU_APP_SECRET。也支持用同名环境变量提供。" },
					{ key: "brand", type: "select", label: "品牌", options: [["feishu", "飞书（中国）"], ["lark", "Lark（国际）"]] }
				]
			},
			{
				title: "默认落点与身份",
				fields: [
					{ key: "defaultFolderToken", type: "text", label: "默认文件夹 token", hint: "新建文档 / 表格 / 多维表格的默认落点；留空表示身份根目录。" },
					{ key: "defaultIdentity", type: "select", label: "默认身份", options: [["auto", "自动（优先用户）"], ["user", "用户"], ["app", "应用"]] }
				]
			},
			{
				title: "功能开关",
				fields: [
					{ key: "enableTools", type: "toggle", label: "注册工具" },
					{ key: "enableOAuth", type: "toggle", label: "挂载 HTTP 路由", hint: "关闭后无法在网页里完成授权回调。" },
					{ key: "enableUi", type: "toggle", label: "显示悬浮面板" },
					{ key: "registerSystemPrompt", type: "toggle", label: "注入系统提示片段" },
					{ key: "toolPrefix", type: "text", label: "工具名前缀", hint: "默认 feishu_。" },
					{ key: "requestTimeoutMs", type: "number", label: "单次请求超时（毫秒）" },
					{ key: "maxRetries", type: "number", label: "最大尝试次数", hint: "1 到 6。" }
				]
			},
			{
				title: "授权",
				fields: [
					{ key: "oauthScopes", type: "list", label: "申请的 scopes", hint: "逗号或空格分隔。必须有 offline_access，否则拿不到 refresh_token。" },
					{ key: "oauthRedirectUri", type: "text", label: "重定向 URL 覆盖", hint: "留空则用本机 Web 服务的回调地址；必须与飞书应用里登记的一致。" }
				]
			},
			{
				title: "高级",
				fields: [
					{ key: "apiBaseUrl", type: "text", label: "API 基址覆盖", hint: "留空用品牌默认值。" },
					{ key: "accountsBaseUrl", type: "text", label: "账号服务基址覆盖" },
					{ key: "activityLogSize", type: "number", label: "面板历史条数" },
					{ key: "maxRecordsPerPage", type: "number", label: "分页每页上限" }
				]
			}
		];

		/**
		 * Turn a stored value into the text a form control shows.
		 * @param field - the field plan.
		 * @param value - the stored value.
		 * @returns the display value.
		 */
		function toDraft(field, value) {
			if (field.type === "toggle") return value === true;
			if (field.type === "list") return Array.isArray(value) ? value.join(", ") : (value === null || value === undefined ? "" : String(value));
			return value === null || value === undefined ? "" : String(value);
		}

		/**
		 * Turn a form value into the value the host validates.
		 * @param field - the field plan.
		 * @param value - the form value.
		 * @returns the value to submit.
		 */
		function fromDraft(field, value) {
			if (field.type === "toggle") return value === true;
			if (field.type === "number") {
				const text = String(value !== undefined && value !== null ? value : "").trim();
				if (text.length === 0) return "";
				const parsed = Number(text);
				return Number.isFinite(parsed) ? parsed : text;
			}
			if (field.type === "list") {
				return String(value !== undefined && value !== null ? value : "").split(/[,\s]+/).filter((entry) => entry.length > 0);
			}
			return String(value !== undefined && value !== null ? value : "");
		}

		/**
		 * The Feishu settings page.
		 *
		 * The page is self-contained: it reads and writes the plugin's own HTTP
		 * endpoints, so it works without the harness settings service and without
		 * the plugin importing anything from the SDK.
		 *
		 * @returns the rendered element.
		 */
		function FeishuSettingsSection() {
			const [config, setConfig] = react.useState(null);
			const [status, setStatus] = react.useState(null);
			const [activity, setActivity] = react.useState([]);
			const [draft, setDraft] = react.useState({});
			const [secret, setSecret] = react.useState("");
			const [authUrl, setAuthUrl] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [message, setMessage] = react.useState(null);
			const [error, setError] = react.useState(null);
			const epoch = react.useRef(0);

			/**
			 * Apply a configuration payload to the form state.
			 * @param payload - the /api/feishu/config data.
			 */
			function applyConfig(payload) {
				setConfig(payload);
				const next = {};
				for (const group of SETTINGS_GROUPS) {
					for (const field of group.fields) {
						if (field.type === "password") continue;
						next[field.key] = toDraft(field, payload.values !== undefined ? payload.values[field.key] : null);
					}
				}
				setDraft(next);
			}

			/** Load configuration, authorization status, and recent activity. */
			const load = react.useCallback(() => {
				const current = ++epoch.current;
				return Promise.all([getJson(CONFIG_URL), getJson(STATUS_URL), getJson(ACTIVITY_URL)])
					.then(([configPayload, statusPayload, activityPayload]) => {
						if (current !== epoch.current) return;
						if (configPayload != null && configPayload.ok === true) {
							applyConfig(configPayload.data);
							setError(null);
						} else {
							setError(configPayload != null && configPayload.message ? configPayload.message : "读取配置失败");
						}
						if (statusPayload != null && statusPayload.ok === true) setStatus(statusPayload.data);
						if (activityPayload != null && activityPayload.ok === true && Array.isArray(activityPayload.data)) setActivity(activityPayload.data.slice(-8).reverse());
					})
					.catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
			}, []);

			/**
			 * Ask the host for the authorization URL.
			 *
			 * The URL is fetched rather than assumed so it can be shown and copied: a
			 * desktop shell is free to block window.open, and a link the user can
			 * paste into their own browser is the one path that always works.
			 */
			const loadAuthUrl = react.useCallback(() => {
				return getJson(AUTHORIZE_URL + "?json=1")
					.then((payload) => {
						if (payload != null && payload.ok === true && typeof payload.url === "string") setAuthUrl(payload.url);
					})
					.catch(() => { /* the host reports the real problem when the flow starts */ });
			}, []);

			react.useEffect(() => {
				load().then(() => loadAuthUrl());
			}, [load, loadAuthUrl]);

			/**
			 * Update one field in the draft.
			 * @param key - the field key.
			 * @param value - the new form value.
			 */
			function setField(key, value) {
				setDraft((previous) => ({ ...previous, [key]: value }));
			}

			/** Submit the form. */
			function save() {
				const values = {};
				for (const group of SETTINGS_GROUPS) {
					for (const field of group.fields) {
						if (field.type === "password") continue;
						const value = fromDraft(field, draft[field.key]);
						// An emptied scope list means "go back to the recommended set",
						// which is expressed by removing the key rather than storing [].
						values[field.key] = field.type === "list" && Array.isArray(value) && value.length === 0 ? null : value;
					}
				}
				const body = { values };
				if (secret.length > 0) body.appSecret = secret;
				setBusy(true);
				setMessage(null);
				setError(null);
				getJson(CONFIG_URL, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify(body)
				})
					.then((payload) => {
						if (payload != null && payload.ok === true) {
							applyConfig(payload.data);
							setSecret("");
							setMessage({ tone: "ok", text: "已保存。宿主会热加载配置，无需重启。" });
							window.setTimeout(() => load(), 800);
						} else {
							setError(payload != null && payload.message ? payload.message : "保存失败");
						}
					})
					.catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))
					.finally(() => setBusy(false));
			}

			/** Try to open the authorization page in a new tab. */
			function authorize() {
				window.open(authUrl.length > 0 ? authUrl : AUTHORIZE_URL, "_blank", "noopener,noreferrer");
				setMessage({ tone: "ok", text: "已尝试打开授权页。若新标签没出现，请把下面的链接复制到浏览器打开。" });
				window.setTimeout(() => load(), 5000);
			}

			/** Copy the authorization URL to the clipboard. */
			function copyAuthUrl() {
				const text = authUrl.length > 0 ? authUrl : AUTHORIZE_URL;
				const done = () => setMessage({ tone: "ok", text: "授权链接已复制，粘贴到浏览器打开即可。" });
				if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
					navigator.clipboard.writeText(text).then(done).catch(() => {
						setMessage({ tone: "err", text: "复制失败，请手动选中链接复制。" });
					});
				} else {
					setMessage({ tone: "err", text: "浏览器不支持自动复制，请手动选中链接复制。" });
				}
			}

			/** Forget the stored user grant. */
			function logout() {
				setBusy(true);
				getJson(LOGOUT_URL, { method: "POST" })
					.then(() => load())
					.then(() => setMessage({ tone: "ok", text: "已解除授权。" }))
					.finally(() => setBusy(false));
			}

			const user = status !== null && status.user !== undefined ? status.user : undefined;
			const authorized = user !== undefined && user.authorized === true;
			const appReady = status !== null && status.appSecretConfigured === true && typeof status.appId === "string" && status.appId.length > 0;
			const tone = error !== null ? "err" : authorized ? "ok" : appReady ? "warn" : "err";
			const dotColor = error !== null
				? "var(--dsw-alias-state-danger-primary,#ff7875)"
				: authorized
					? "var(--dsw-alias-state-success-primary,#3fb950)"
					: appReady
						? "var(--dsw-alias-state-warn-primary,#f59e0b)"
						: "var(--dsw-alias-label-tertiary,#76768a)";
			const headline = authorized
				? "已授权：" + (user.name !== undefined ? user.name : "用户")
				: appReady
					? "应用凭据可用，但还没有用户授权"
					: "尚未配置完成";
			const redirectUri = config !== null && config.redirectUri !== undefined && config.redirectUri.length > 0 ? config.redirectUri : "（未检测到）";

			if (config === null) {
				return react.createElement("div", { className: "dsh-feishu-set" },
					error !== null ? react.createElement("div", { className: "dsh-feishu-set-msg err", children: error }) : react.createElement("div", { className: "dsh-feishu-set-msg", children: "正在读取飞书配置…" })
				);
			}

			const children = [];

			children.push(react.createElement("div", { className: "dsh-feishu-set-hero", key: "hero" },
				react.createElement("span", { className: "dsh-feishu-dot", style: { background: dotColor } }),
				react.createElement("div", { className: "dsh-feishu-set-hero-main" },
					react.createElement("div", { className: "dsh-feishu-set-hero-title", children: headline }),
					react.createElement("div", { className: "dsh-feishu-set-hero-sub", children: "配置文件：" + (config.patch !== undefined && config.patch.file !== null ? config.patch.file : "未定位") })
				)
			));

			if (error !== null) children.push(react.createElement("div", { className: "dsh-feishu-set-msg err", key: "err", children: error }));
			if (message !== null) children.push(react.createElement("div", { className: "dsh-feishu-set-msg " + message.tone, key: "msg", children: message.text }));
			if (config.patch !== undefined && config.patch.error !== null && config.patch.error !== undefined) {
				children.push(react.createElement("div", { className: "dsh-feishu-set-msg err", key: "patcherr", children: "配置文件不可写：" + config.patch.error }));
			}
			if (config.patch !== undefined && Array.isArray(config.patch.unmanagedKeys) && config.patch.unmanagedKeys.length > 0) {
				children.push(react.createElement("div", { className: "dsh-feishu-set-msg", key: "unmanaged", children: "以下配置项不由本页面管理，已原样保留：" + config.patch.unmanagedKeys.join(", ") }));
			}

			for (const group of SETTINGS_GROUPS) {
				const rows = group.fields.map((field) => {
					const value = field.type === "password" ? secret : draft[field.key];
					let control;
					if (field.type === "toggle") {
						control = react.createElement("label", { className: "dsh-feishu-set-check" },
							react.createElement("input", {
								type: "checkbox",
								checked: value === true,
								onChange: (event) => setField(field.key, event.target.checked)
							}),
							react.createElement("span", { children: value === true ? "启用" : "关闭" })
						);
					} else if (field.type === "select") {
						control = react.createElement("select", {
							className: "dsh-feishu-set-select",
							value: value === undefined || value === null ? "" : String(value),
							onChange: (event) => setField(field.key, event.target.value)
						}, field.options.map(([optionValue, optionLabel]) => react.createElement("option", { value: optionValue, key: optionValue, children: optionLabel })));
					} else {
						control = react.createElement("input", {
							className: "dsh-feishu-set-input",
							type: field.type === "password" ? "password" : "text",
							value: value === undefined || value === null ? "" : String(value),
							placeholder: field.type === "password" ? "留空表示不修改" : "",
							autoComplete: "off",
							spellCheck: false,
							onChange: (event) => {
								if (field.type === "password") setSecret(event.target.value);
								else setField(field.key, event.target.value);
							}
						});
					}
					const stack = [control];
					if (field.hint !== undefined) stack.push(react.createElement("div", { className: "dsh-feishu-set-hint", key: "hint", children: field.hint }));
					const isDefault = field.type !== "password"
						&& (config.stored === undefined || config.stored[field.key] === undefined);
					return react.createElement("div", { className: "dsh-feishu-set-field", key: field.key },
						react.createElement("div", { className: "dsh-feishu-set-label" },
							field.label,
							isDefault ? react.createElement("div", { className: "dsh-feishu-set-hint", children: "默认值" }) : null
						),
						react.createElement("div", null, stack)
					);
				});
				children.push(react.createElement("div", { className: "dsh-feishu-set-group", key: group.title },
					react.createElement("h4", { children: group.title }),
					rows
				));
			}

			children.push(react.createElement("div", { className: "dsh-feishu-set-bar", key: "savebar" },
				react.createElement("button", { className: "dsh-feishu-btn primary", disabled: busy, onClick: save, children: busy ? "保存中…" : "保存" }),
				react.createElement("button", { className: "dsh-feishu-btn", disabled: busy, onClick: () => load(), children: "放弃修改并重载" })
			));

			children.push(react.createElement("div", { className: "dsh-feishu-set-group", key: "auth" },
				react.createElement("h4", { children: "用户授权" }),
				react.createElement("div", { className: "dsh-feishu-set-hint", children: "授权后，新建的文档 / 表格 / 多维表格才会落在你自己的云空间。" }),
				react.createElement("div", { className: "dsh-feishu-set-hint" },
					"请在飞书应用的安全设置里登记这个重定向 URL：",
					react.createElement("div", { className: "dsh-feishu-set-code", children: redirectUri })
				),
				react.createElement("div", { className: "dsh-feishu-set-bar", style: { marginTop: "8px" } },
					react.createElement("button", { className: "dsh-feishu-btn primary", disabled: busy || !appReady, onClick: authorize, children: authorized ? "重新授权" : "授权飞书" }),
					react.createElement("button", { className: "dsh-feishu-btn", disabled: busy || !appReady, onClick: copyAuthUrl, children: "复制授权链接" }),
					react.createElement("button", { className: "dsh-feishu-btn", disabled: busy, onClick: () => load().then(() => loadAuthUrl()), children: "刷新状态" }),
					react.createElement("button", { className: "dsh-feishu-btn", disabled: busy || !authorized, onClick: logout, children: "解除授权" })
				),
				!appReady ? react.createElement("div", { className: "dsh-feishu-set-hint dsh-feishu-err", children: "请先填写 App ID 并保存 App Secret，授权按钮才会启用。" }) : null,
				react.createElement("input", {
					className: "dsh-feishu-set-input",
					readOnly: true,
					style: { marginTop: "6px" },
					value: authUrl,
					placeholder: appReady ? "正在获取授权链接…" : "配置完成后这里会显示授权链接",
					onFocus: (event) => event.target.select()
				}),
				react.createElement("div", { className: "dsh-feishu-set-hint", children: "点「授权飞书」没反应的话，把上面这条链接复制到浏览器里打开。" }),
				react.createElement("div", { className: "dsh-feishu-set-hint", style: { marginTop: "8px", lineHeight: "1.7" } },
					react.createElement("div", { children: "授权前请确认飞书应用侧已经做完这三件事（少一件都会失败）：" }),
					react.createElement("div", { children: "1. 安全设置 → 重定向 URL，逐字填上面那个地址（端口也要一致）" }),
					react.createElement("div", { children: "2. 权限管理 → 至少开通 offline_access 与 bitable:app" }),
					react.createElement("div", { children: "3. 版本管理与发布 → 创建版本并发布（只勾权限不发版不生效）" })
				),
				react.createElement("div", { className: "dsh-feishu-set-hint", children: user !== undefined && user.authorized === true
					? "当前身份：" + (user.name !== undefined ? user.name : user.openId !== undefined ? user.openId : "已授权") + (user.expiresAt !== undefined ? "，令牌到期 " + new Date(user.expiresAt).toLocaleString() : "")
					: "当前没有用户授权，工具会以应用身份运行并在结果里给出警告。" })
			));

			const items = activity.length > 0
				? activity.map((entry) => react.createElement("div", { className: "dsh-feishu-item", key: String(entry.seq) },
					react.createElement("div", { className: entry.ok === false ? "dsh-feishu-sum dsh-feishu-err" : "dsh-feishu-sum" },
						entry.url !== undefined && entry.url.length > 0
							? react.createElement("a", { className: "dsh-feishu-link", href: entry.url, target: "_blank", rel: "noreferrer", children: entry.summary })
							: entry.summary
					),
					react.createElement("div", { className: "dsh-feishu-meta", children: clock(entry.at) + " · " + entry.tool + (entry.identity !== undefined ? " · " + entry.identity : "") })
				))
				: [react.createElement("div", { className: "dsh-feishu-hint", key: "none", children: "暂无操作记录。" })];

			children.push(react.createElement("div", { className: "dsh-feishu-set-group", key: "activity" },
				react.createElement("h4", { children: "最近操作" }),
				react.createElement("div", { className: "dsh-feishu-set-list" }, items)
			));

			return react.createElement("div", { className: "dsh-feishu-set" }, children);
		}

		/** Cordis service names this client plugin's fiber waits for. */
		const inject = ["slots"];

		/**
		 * Client plugin body: add the Feishu panel to the frame-wide overlay and
		 * the Feishu page to the settings sidebar.
		 *
		 * Both slots are additive and both are optional: `slots.inject` runs its
		 * callback only once the named slot exists, so a composition without the
		 * settings UI still gets the panel and vice versa.
		 *
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.inject(inject, (scope) => {
				scope.slots.inject("shell.overlay", () => scope.slots.register(
					{ name: "shell.overlay", id: "feishu", order: 90, label: "飞书 / Lark" },
					FeishuPanel
				));
				scope.slots.inject("settings.section", () => scope.slots.register(
					{ name: "settings.section", id: "feishu", order: 60, label: () => "飞书 / Feishu" },
					FeishuSettingsSection
				));
			});
		}

		exports.FeishuPanel = FeishuPanel;
		exports.FeishuSettingsSection = FeishuSettingsSection;
		exports.SETTINGS_GROUPS = SETTINGS_GROUPS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

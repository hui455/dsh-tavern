		function SceneCharacterConfirmation(props) {
			const h = React.createElement, askConfirm = useTavernConfirm(props.sessionId);
			const [data, setData] = React.useState(null), [notice, setNotice] = React.useState(""), [busy, setBusy] = React.useState(false), [messages, setMessages] = React.useState({});
			const active = React.useRef(true);
			const dialog = React.useRef(null);
			React.useEffect(function () { const previous = document.activeElement; if (dialog.current) dialog.current.focus(); return function () { if (previous && previous.isConnected) previous.focus(); }; }, []);
			const address = { turn: props.turn, key: props.record.key };
			const load = React.useCallback(async function () {
				try { const value = await rpc("sceneCharacterLooks", { turn: props.turn, key: props.record.key }, props.sessionId); if (active.current) setData(value); }
				catch (e) { if (active.current) setNotice(String(e.message || e)); }
			}, [props.sessionId, props.turn, props.record.key]);
			React.useEffect(function () { active.current = true; void load(); return function () { active.current = false; }; }, [load]);
			React.useEffect(function () { if (!data || !data.people.some(function (p) { return p.busy; })) return; const timer = window.setTimeout(load, 1500); return function () { window.clearTimeout(timer); }; }, [data, load]);
			async function change(person, action) {
				if (busy || person.busy) return;
				let confirmNewRequestId;
				if (action === "portrait" && person.outcome === "unconfirmed") {
					if (!await askConfirm("上次定妆图结果未确认，可能已生成。仍要重新请求一张吗？")) return;
					confirmNewRequestId = person.operationId;
				}
				setBusy(true); setNotice("");
				try {
					const value = await rpc("changeSceneCharacterLook", Object.assign({}, address, { personId: person.id, revision: person.revision,
						action: action, requestId: sceneImageRequestId(), message: messages[person.id] || "", confirmNewRequestId: confirmNewRequestId,
						candidateId: person.candidate && person.candidate.id, consent: action === "confirm" ? data.capability.gateway : undefined }), props.sessionId);
					if (active.current) { setData(value); if (action === "discuss") setMessages(function (old) { return Object.assign({}, old, { [person.id]: "" }); }); }
				} catch (e) { if (active.current) setNotice(String(e.message || e)); }
				finally { if (active.current) setBusy(false); }
			}
			async function resume() {
				setBusy(true); setNotice("");
				try {
					await rpc("generateSceneImage", Object.assign({}, address, { kind: "generate", requestId: sceneImageRequestId() }), props.sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed", { detail: { sessionId: props.sessionId } })); props.onClose();
				} catch (e) { setNotice(String(e.message || e)); } finally { if (active.current) setBusy(false); }
			}
			const ready = data && data.people.length && data.people.every(function (p) { return p.approved && !p.busy; });
			return h("div", { className: "dsh-tavern-look-backdrop" }, h("section", { ref: dialog, tabIndex: -1, role: "dialog", "aria-modal": "true", "aria-label": "人物形象确认", className: "dsh-tavern-look-dialog",
				onKeyDown: function (event) {
					if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
					if (event.key !== "Tab") return;
					const controls = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex='0']"));
					const first = controls[0], last = controls[controls.length - 1];
					if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); if (last) last.focus(); }
					else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); if (first) first.focus(); }
				} },
				h("div", { className: "dsh-tavern-look-heading" }, h("h2", null, "人物形象确认"), h("button", { type: "button", className: "dsh-tavern-btn", onClick: props.onClose }, "稍后确认")),
				h("p", null, "剧情配图已暂停。这里是独立的形象对话，不修改正文或游戏变量。先讨论外貌、生成定妆图，满意后确认。"),
				data ? h("p", { className: "dsh-tavern-image-hint" }, data.capability.supported ? "当前服务支持参考图：确认后，定妆图将发送给 " + data.capability.service + " 用于后续配图。" : "当前服务未接入参考图：定妆图供你确认，后续配图复用已确认的外貌文字，不上传参考图。") : h("p", null, "正在读取人物…"),
				notice ? h("p", { role: "alert" }, notice) : null,
				data ? data.people.map(function (person) {
					const candidate = person.candidate;
					const url = candidate ? "/api/dsh-tavern/scene-character-image?" + new URLSearchParams({ sessionId: props.sessionId, turn: props.turn, key: props.record.key, personId: person.id, candidateId: candidate.id }) : "";
					return h("article", { key: person.id, className: "dsh-tavern-look-person" }, h("h3", null, person.name, person.approved ? " · 已确认" : " · 待确认"),
						h("p", { className: "dsh-tavern-look-description" }, person.appearance || "尚无明确外貌，请先在下方告诉助手你的要求。"),
						person.history.map(function (m, i) { return h("p", { key: i, className: "dsh-tavern-look-message" }, h("strong", null, m.role === "user" ? "你：" : "形象助手："), m.text); }),
						candidate ? h("img", { src: url, alt: person.name + "的待确认定妆图", className: "dsh-tavern-look-portrait" }) : null,
						person.error ? h("p", { role: "alert" }, person.error) : null,
						person.busy ? h("p", { role: "status" }, "正在处理人物形象…") : null,
						h("textarea", { "aria-label": person.name + "的外貌要求", rows: 3, maxLength: 4000, placeholder: "例如：保留黑发，改成齐肩长度，神情更沉稳。", value: messages[person.id] || "", disabled: busy || person.busy,
							onChange: function (e) { const value = e.target.value; setMessages(function (old) { return Object.assign({}, old, { [person.id]: value }); }); } }),
						h("div", { className: "dsh-tavern-image-actions" },
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || person.busy || !(messages[person.id] || "").trim(), onClick: function () { void change(person, "discuss"); } }, "发送给形象助手"),
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || person.busy || !person.appearance || !person.tags, onClick: function () { void change(person, "portrait"); } }, candidate ? "重新生成定妆图" : "生成定妆图"),
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || person.busy || !candidate || person.approved && (person.referenceMode === "image" || !data.capability.supported), onClick: function () { void change(person, "confirm"); } }, person.approved ? (person.referenceMode === "image" || !data.capability.supported ? "已确认" : "确认当前服务使用参考图") : "确认这个形象")));
				}) : null,
				h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !ready, onClick: resume }, "全部已确认，继续剧情配图")));
		}

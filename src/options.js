const THEME_KEY = "leapTheme";
const storage = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local)
	? chrome.storage.local
	: { get: async () => ({}), set: async () => {} };

const grid = document.getElementById("theme-grid");

const autoCard = () => {
	const card = document.createElement("div");
	card.className = "card";
	card.dataset.theme = "auto";
	card.innerHTML =
		'<div class="preview" style="padding:0">' +
			'<div class="auto-split">' +
				'<div class="half" style="left:0;background:#f6f6f8"></div>' +
				'<div class="half" style="right:0;background:#1e1e20"></div>' +
			'</div>' +
		'</div>' +
		'<div class="cardname"><span>Auto (System)</span><span class="tick">✓</span></div>';
	return card;
};

const themeCard = (key, theme) => {
	const v = theme.vars;
	const card = document.createElement("div");
	card.className = "card";
	card.dataset.theme = key;
	card.innerHTML =
		'<div class="preview" style="background:' + v["--panel-solid"] + '">' +
			'<div class="bar" style="background:' + v["--text"] + '"></div>' +
			'<div class="bar b2" style="background:' + v["--text-2"] + '"></div>' +
			'<div class="bar b3" style="background:' + v["--text-3"] + '"></div>' +
			'<div class="chiprow">' +
				'<div class="chip accent" style="background:' + v["--accent"] + '"></div>' +
				'<div class="chip match" style="background:' + v["--match"] + '"></div>' +
			'</div>' +
		'</div>' +
		'<div class="cardname"><span>' + theme.name + '</span><span class="tick">✓</span></div>';
	return card;
};

const select = (key) => {
	document.querySelectorAll(".card").forEach((card) => {
		card.classList.toggle("selected", card.dataset.theme === key);
	});
};

grid.appendChild(autoCard());
Object.keys(LEAP_THEMES).forEach((key) => grid.appendChild(themeCard(key, LEAP_THEMES[key])));

grid.addEventListener("click", (e) => {
	const card = e.target.closest(".card");
	if (!card) return;
	select(card.dataset.theme);
	storage.set({ [THEME_KEY]: card.dataset.theme });
});

storage.get(THEME_KEY).then((data) => {
	var stored = (data && data[THEME_KEY]) || "bright";
	if (stored === "white") {
		stored = "bright";
	}
	select(stored);
});

const SUGGEST_KEY = "leapLiveSuggestions";
const suggestToggle = document.getElementById("live-suggestions");
storage.get(SUGGEST_KEY).then((data) => {
	suggestToggle.checked = !(data && data[SUGGEST_KEY] === false);
});
suggestToggle.addEventListener("change", () => {
	storage.set({ [SUGGEST_KEY]: suggestToggle.checked });
});

const SCALE_KEY = "leapUiScale";
const scaleSlider = document.getElementById("ui-scale");
const scaleValue = document.getElementById("scale-value");
storage.get(SCALE_KEY).then((data) => {
	const percent = Math.round(((data && data[SCALE_KEY]) || 1) * 100);
	scaleSlider.value = percent;
	scaleValue.textContent = percent + "%";
});
scaleSlider.addEventListener("input", () => {
	scaleValue.textContent = scaleSlider.value + "%";
	storage.set({ [SCALE_KEY]: scaleSlider.value / 100 });
});

// Width sliders for the palette and the drawer
const wireWidthSlider = (sliderId, badgeId, storageKey, fallback) => {
	const slider = document.getElementById(sliderId);
	const badge = document.getElementById(badgeId);
	storage.get(storageKey).then((data) => {
		const width = parseInt(data && data[storageKey], 10) || fallback;
		slider.value = width;
		badge.textContent = width + "px";
	});
	slider.addEventListener("input", () => {
		badge.textContent = slider.value + "px";
		storage.set({ [storageKey]: parseInt(slider.value, 10) });
	});
};
wireWidthSlider("palette-width", "palette-width-value", "leapPaletteWidth", 680);
wireWidthSlider("drawer-width", "drawer-width-value", "leapDrawerWidth", 360);

const RAIL_KEY = "leapShowRail";
const railToggle = document.getElementById("show-rail");
storage.get(RAIL_KEY).then((data) => {
	railToggle.checked = !!(data && data[RAIL_KEY] === true);
});
railToggle.addEventListener("change", () => {
	storage.set({ [RAIL_KEY]: railToggle.checked });
});

// Keyboard shortcuts: Chrome owns command bindings, so show the live ones
// and deep-link to Chrome's editor where they can be changed
const COMMAND_LABELS = {
	"open-omni": "Open the command palette",
	"open-recents": "Open the recents switcher",
	"open-explorer": "Toggle the explorer drawer"
};
const shortcutsList = document.getElementById("shortcuts-list");
const renderShortcutRow = (label, shortcut) => {
	const row = document.createElement("div");
	row.className = "shortcut-row";
	const name = document.createElement("span");
	name.textContent = label;
	const key = document.createElement("kbd");
	if (shortcut) {
		key.textContent = shortcut;
	} else {
		key.textContent = "Not set";
		key.className = "unset";
	}
	row.appendChild(name);
	row.appendChild(key);
	shortcutsList.appendChild(row);
};
// Editable in-palette chord: click the chip, press keys, saved instantly
const CLOSE_BINDING_KEY = "leapCloseTabShortcut";
const isMacOptions = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const DEFAULT_CLOSE_BINDING = isMacOptions
	? { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, code: "Backspace", label: "⌘⌫" }
	: { metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, code: "Backspace", label: "Ctrl+⌫" };

const bindingLabel = (e) => {
	const parts = [];
	if (isMacOptions) {
		if (e.ctrlKey) parts.push("⌃");
		if (e.altKey) parts.push("⌥");
		if (e.shiftKey) parts.push("⇧");
		if (e.metaKey) parts.push("⌘");
	} else {
		if (e.ctrlKey) parts.push("Ctrl");
		if (e.altKey) parts.push("Alt");
		if (e.shiftKey) parts.push("Shift");
		if (e.metaKey) parts.push("Win");
	}
	let key = e.code;
	if (key.indexOf("Key") === 0) key = key.slice(3);
	else if (key.indexOf("Digit") === 0) key = key.slice(5);
	else if (key === "Backspace") key = "⌫";
	else if (key === "Delete") key = "⌦";
	else key = e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key;
	return isMacOptions ? parts.join("") + key : parts.concat([key]).join("+");
};

let recordingClose = false;
const renderCloseBindingRow = () => {
	const row = document.createElement("div");
	row.className = "shortcut-row";
	const name = document.createElement("span");
	name.textContent = "Close tab in the list";
	const controls = document.createElement("span");
	const chip = document.createElement("kbd");
	chip.className = "editable";
	chip.title = "Click, then press the keys you want";
	const reset = document.createElement("button");
	reset.className = "reset-btn";
	reset.title = "Reset to default";
	reset.textContent = "↺";
	controls.appendChild(chip);
	controls.appendChild(reset);
	row.appendChild(name);
	row.appendChild(controls);
	shortcutsList.appendChild(row);

	const setChip = (binding) => {
		chip.textContent = binding.label;
		chip.classList.remove("recording");
	};
	storage.get(CLOSE_BINDING_KEY).then((data) => {
		setChip((data && data[CLOSE_BINDING_KEY]) || DEFAULT_CLOSE_BINDING);
	});
	chip.addEventListener("click", () => {
		recordingClose = true;
		chip.textContent = "Press keys…";
		chip.classList.add("recording");
	});
	reset.addEventListener("click", () => {
		recordingClose = false;
		storage.set({ [CLOSE_BINDING_KEY]: DEFAULT_CLOSE_BINDING });
		setChip(DEFAULT_CLOSE_BINDING);
	});
	window.addEventListener("keydown", (e) => {
		if (!recordingClose) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Escape") {
			recordingClose = false;
			storage.get(CLOSE_BINDING_KEY).then((data) => setChip((data && data[CLOSE_BINDING_KEY]) || DEFAULT_CLOSE_BINDING));
			return;
		}
		if (["Meta", "Control", "Alt", "Shift"].indexOf(e.key) > -1) return;
		if (!e.metaKey && !e.ctrlKey && !e.altKey) {
			chip.textContent = "Add ⌘, ⌃, or ⌥…";
			return;
		}
		const binding = { metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, code: e.code, label: bindingLabel(e) };
		recordingClose = false;
		storage.set({ [CLOSE_BINDING_KEY]: binding });
		setChip(binding);
	}, true);
};

const renderAllShortcutRows = (commands) => {
	Object.keys(COMMAND_LABELS).forEach((name) => {
		const command = commands && commands.find((c) => c.name === name);
		renderShortcutRow(COMMAND_LABELS[name], command && command.shortcut);
	});
	renderCloseBindingRow();
};
if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.getAll) {
	chrome.commands.getAll().then(renderAllShortcutRows);
} else {
	renderAllShortcutRows(null);
}
document.getElementById("edit-shortcuts").addEventListener("click", () => {
	if (typeof chrome !== "undefined" && chrome.tabs) {
		chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
	}
});

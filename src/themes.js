// Themes for Leap. Each theme carries the full set of CSS variables the UI
// is built from; "auto" (absent here) falls back to the system palette in
// content.css. Shared by the content script and the options page.
var LEAP_THEMES = (() => {
	const rgba = (hex, alpha) => {
		const n = parseInt(hex.slice(1), 16);
		return "rgba(" + (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + alpha + ")";
	};
	const light = (name, panel, accent, ink) => ({
		name: name,
		appearance: "light",
		vars: {
			"--panel": rgba(panel, 0.95),
			"--panel-solid": panel,
			"--hairline": "rgba(0, 0, 0, 0.08)",
			"--edge": "rgba(255, 255, 255, 0.9)",
			"--text": ink || "rgba(0, 0, 0, 0.92)",
			"--text-2": "rgba(0, 0, 0, 0.55)",
			"--text-3": "rgba(0, 0, 0, 0.38)",
			"--select": rgba(accent, 0.14),
			"--select-hover": "rgba(0, 0, 0, 0.05)",
			"--accent": accent,
			"--key-bg": "rgba(0, 0, 0, 0.05)",
			"--key-border": "rgba(0, 0, 0, 0.07)",
			"--placeholder": "rgba(0, 0, 0, 0.28)",
			"--overlay": "rgba(0, 0, 0, 0.22)",
			"--match": "rgba(255, 214, 10, 0.55)",
			"--shadow": "0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 28px 72px rgba(0, 0, 0, 0.28), 0 6px 20px rgba(0, 0, 0, 0.12)"
		}
	});
	const dark = (name, panel, accent) => ({
		name: name,
		appearance: "dark",
		vars: {
			"--panel": rgba(panel, 0.93),
			"--panel-solid": panel,
			"--hairline": "rgba(255, 255, 255, 0.09)",
			"--edge": "rgba(255, 255, 255, 0.14)",
			"--text": "rgba(255, 255, 255, 0.92)",
			"--text-2": "rgba(255, 255, 255, 0.55)",
			"--text-3": "rgba(255, 255, 255, 0.35)",
			"--select": rgba(accent, 0.3),
			"--select-hover": "rgba(255, 255, 255, 0.06)",
			"--accent": accent,
			"--key-bg": "rgba(255, 255, 255, 0.07)",
			"--key-border": "rgba(255, 255, 255, 0.08)",
			"--placeholder": "rgba(255, 255, 255, 0.28)",
			"--overlay": "rgba(0, 0, 0, 0.3)",
			"--match": "rgba(255, 214, 10, 0.32)",
			"--shadow": "0 0 0 0.5px rgba(0, 0, 0, 0.6), 0 24px 64px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.35)"
		}
	});
	// Fully opaque white — no frost, so the page never tints it grey
	const bright = light("Bright White", "#ffffff", "#007aff", "rgba(0, 0, 0, 0.78)");
	bright.vars["--panel"] = "#ffffff";
	bright.vars["--hairline"] = "rgba(0, 0, 0, 0.07)";
	bright.vars["--key-bg"] = "rgba(0, 0, 0, 0.04)";
	bright.vars["--key-border"] = "rgba(0, 0, 0, 0.06)";
	return {
		"bright": bright,
		"white": light("Pure White", "#ffffff", "#007aff", "rgba(0, 0, 0, 0.75)"),
		"paper": light("Paper", "#faf7f0", "#c2410c", "rgba(41, 30, 20, 0.85)"),
		"sakura": light("Sakura", "#fdf2f6", "#ec4899"),
		"lavender": light("Lavender", "#f7f5ff", "#7c3aed"),
		"mint": light("Mint", "#f0faf4", "#059669"),
		"graphite": dark("Graphite", "#161618", "#a1a1a6"),
		"midnight": dark("Midnight", "#0d1117", "#58a6ff"),
		"slate": dark("Slate", "#1e293b", "#38bdf8"),
		"forest": dark("Forest", "#10201a", "#34d399"),
		"ember": dark("Ember", "#211511", "#fb923c")
	};
})();

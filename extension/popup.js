(() => {
  "use strict";
  const Rules = globalThis.ZhuSieveRules;
  const fieldset = document.getElementById("types");
  const status = document.getElementById("status");
  let saved = [...Rules.defaults];
  let busy = false;
  const inputs = new Map();
  for (const type of Rules.types) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = type.id;
    input.id = `type-${type.id}`;
    label.append(input, document.createTextNode(type.label));
    fieldset.append(label);
    inputs.set(type.id, input);
  }

  function render(selection) {
    saved = Rules.normalizeSelection(selection);
    for (const [id, input] of inputs) input.checked = saved.includes(id);
  }

  fieldset.addEventListener("change", async () => {
    if (busy) return;
    busy = true;
    fieldset.disabled = true;
    status.textContent = "";
    const next = [...inputs].filter(([, input]) => input.checked).map(([id]) => id);
    try {
      await chrome.storage.local.set({ visibleTypes: next });
      render(next);
    } catch {
      render(saved);
      status.textContent = "保存失败，请重试";
    } finally {
      busy = false;
      fieldset.disabled = false;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, "visibleTypes")) render(changes.visibleTypes.newValue);
  });
  chrome.storage.local.get("visibleTypes").then(data => {
    render(data.visibleTypes);
    fieldset.disabled = false;
  }).catch(() => { status.textContent = "读取失败，请重新打开插件"; });
})();

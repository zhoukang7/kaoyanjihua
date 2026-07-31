(() => {
  const reasons = ["每日任务完成", "每日学习量等效"];
  let observer = null;

  const q = (id) => document.getElementById(id);

  function syncSelection(container, currentValue) {
    container.querySelectorAll("button[data-points-reason]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.pointsReason === currentValue)
      );
    });
  }

  function mountReasonPresets() {
    if (document.querySelector(".points-reason-presets")) return true;

    const noteInput = q("manualGrantNote");
    const form = noteInput?.closest(".points-admin-grant-form");
    if (!noteInput || !form) return false;

    const container = document.createElement("div");
    container.className = "points-reason-presets";
    container.setAttribute("aria-label", "积分发放快捷原因");

    const label = document.createElement("span");
    label.className = "points-reason-presets-label";
    label.textContent = "快捷原因";
    container.appendChild(label);

    reasons.forEach((reason) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-review-ghost points-reason-preset";
      button.dataset.pointsReason = reason;
      button.textContent = reason;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        noteInput.value = reason;
        noteInput.dispatchEvent(new Event("input", { bubbles: true }));
        syncSelection(container, reason);

        const amountInput = q("manualGrantAmount");
        amountInput?.focus();
        amountInput?.select();
      });
      container.appendChild(button);
    });

    noteInput.addEventListener("input", () => {
      syncSelection(container, noteInput.value.trim());
    });

    form.appendChild(container);
    syncSelection(container, noteInput.value.trim());
    return true;
  }

  function start() {
    if (mountReasonPresets()) return;

    observer = new MutationObserver(() => {
      if (mountReasonPresets()) {
        observer?.disconnect();
        observer = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

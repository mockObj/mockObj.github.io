export function initMenu() {
  const burger  = document.querySelector(".hamburger");
  const overlay = document.getElementById("nav-overlay");
  const closeBtn = overlay?.querySelector(".nav-close");

  if (!burger || !overlay) return;

  const open = () => {
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("nav-open");
  };
  const close = () => {
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("nav-open");
  };

  burger.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

// 初回ロード
document.addEventListener("DOMContentLoaded", initMenu);
// ページ遷移後 (Astro ViewTransitions 用)
document.addEventListener("astro:after-swap", initMenu);

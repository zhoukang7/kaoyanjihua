// Local development template. GitHub Pages generates its own config.js from repository secrets.
// Never put a Supabase service_role key in this browser file.
window.STUDY_APP_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  loginEmailDomain: "study822.example.com"
};

(() => {
  ["comments.css", "task-review.css", "points-control.css", "reward-presets.css"].forEach((href) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `./${href}`;
    document.head.appendChild(stylesheet);
  });

  ["comments.js", "task-review.js", "points-control.js", "reward-presets.js", "learning-communication.js"].forEach((src) => {
    const script = document.createElement("script");
    script.src = `./${src}`;
    script.defer = true;
    document.head.appendChild(script);
  });
})();

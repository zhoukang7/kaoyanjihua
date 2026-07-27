// Local development template. GitHub Pages generates its own config.js from repository secrets.
// Never put a Supabase service_role key in this browser file.
window.STUDY_APP_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  loginEmailDomain: "study822.example.com"
};

(() => {
  [
    "comments.css",
    "task-review.css",
    "points-control.css",
    "points-deduction.css",
    "reward-presets.css"
  ].forEach((href) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `./${href}`;
    document.head.appendChild(stylesheet);
  });

  [
    "comments.js",
    "task-review.js",
    "points-control.js",
    "points-deduction.js",
    "reward-presets.js",
    "learning-communication.js",
    "reward-presets-stability.js"
  ].forEach((src) => {
    const script = document.createElement("script");
    script.src = `./${src}`;
    script.async = false;
    document.head.appendChild(script);
  });
})();

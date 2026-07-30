// Local development template. GitHub Pages generates its own config.js from repository secrets.
// Never put a Supabase service_role key in this browser file.
window.STUDY_APP_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  loginEmailDomain: "study822.example.com"
};

(() => {
  const config = window.STUDY_APP_CONFIG || {};
  const supabaseGlobal = window.supabase;

  if (
    !window.getStudySupabaseClient &&
    supabaseGlobal &&
    typeof supabaseGlobal.createClient === "function" &&
    config.supabaseUrl &&
    config.supabasePublishableKey
  ) {
    const originalCreateClient = supabaseGlobal.createClient.bind(supabaseGlobal);
    let sharedClient = null;

    window.getStudySupabaseClient = () => {
      if (!sharedClient) {
        sharedClient = originalCreateClient(
          config.supabaseUrl,
          config.supabasePublishableKey,
          { auth: { persistSession: true, autoRefreshToken: true } }
        );
        window.STUDY_SUPABASE_CLIENT = sharedClient;
      }
      return sharedClient;
    };

    supabaseGlobal.createClient = (url, key, options) => {
      if (url === config.supabaseUrl && key === config.supabasePublishableKey) {
        return window.getStudySupabaseClient();
      }
      return originalCreateClient(url, key, options);
    };
  }

  [
    "comments.css",
    "task-review.css",
    "daily-task-settings.css",
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
    "daily-task-settings.js",
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

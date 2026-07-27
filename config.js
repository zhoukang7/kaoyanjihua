// Local development template. GitHub Pages generates its own config.js from repository secrets.
// Never put a Supabase service_role key in this browser file.
window.STUDY_APP_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  loginEmailDomain: "study822.example.com"
};

(() => {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./comments.css";
  document.head.appendChild(stylesheet);

  const script = document.createElement("script");
  script.src = "./comments.js";
  script.defer = true;
  document.head.appendChild(script);
})();

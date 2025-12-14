import { supabase } from "../lib/supabase";

const THEMES = ["green", "dark", "blue", "purple"];

export default function ThemeSwitcher({ user, currentTheme, setTheme }) {
  const applyTheme = async (t) => {
    document.documentElement.setAttribute("data-theme", t);
    setTheme(t);

    await supabase.from("profiles").upsert({
      id: user.id,
      theme: t,
    });
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {THEMES.map((t) => (
        <button key={t} onClick={() => applyTheme(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

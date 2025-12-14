import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ChatLayout from "../components/ChatLayout";
import ThemeSwitcher from "../components/ThemeSwitcher";

export default function Chat() {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState("green");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setUser(data.user);

      const { data: profile } = await supabase
        .from("profiles")
        .select("theme")
        .eq("id", data.user.id)
        .single();

      const t = profile?.theme || "green";
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
    })();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  if (!user) return null;

  return (
    <>
      <ChatLayout />
      <div style={{ position: "absolute", top: 10, right: 10 }}>
        <ThemeSwitcher user={user} currentTheme={theme} setTheme={setTheme} />
        <button onClick={logout} style={{ marginLeft: 8 }}>Logout</button>
      </div>
    </>
  );
}

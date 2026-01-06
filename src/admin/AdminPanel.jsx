import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AdminPanel() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, username, email, is_banned")
      .then(({ data }) => setUsers(data || []));
  }, []);

  async function toggleBan(user) {
    await supabase
      .from("profiles")
      .update({ is_banned: !user.is_banned })
      .eq("id", user.id);

    setUsers((prev) =>
      prev.map((u) =>
        u.id === user.id ? { ...u, is_banned: !u.is_banned } : u
      )
    );
    async function banUser(u) {
  // 1️⃣ Update profile
  await supabase
    .from("profiles")
    .update({ is_banned: true })
    .eq("id", u.id);

  // 2️⃣ Log admin action  ✅ THIS IS WHERE YOUR CODE GOES
  await supabase.from("admin_logs").insert({
    admin_id: user.id,
    action: "BAN_USER",
    target_id: u.id,
  });
  
}
const { data: flaggedMessages } = await supabase
  .from("messages")
  .select("*")
  .eq("flagged", true);


  }
  

  return (
    <div style={{ padding: 20 }}>
      <h2>🛡️ Admin Dashboard</h2>

      {users.map((u) => (
        <div
          key={u.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: 10,
            borderBottom: "1px solid #ddd",
          }}
        >
          <div>
            <strong>{u.username}</strong>
            <div style={{ fontSize: 12 }}>{u.email}</div>
          </div>
        

          <button
            onClick={() => toggleBan(u)}
            style={{
              background: u.is_banned ? "green" : "red",
              color: "#fff",
              border: "none",
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            {u.is_banned ? "Unban" : "Ban"}
          </button>
          <button
  onClick={() => banUser(u)}
  style={{ color: "red" }}
>
  Ban
</button>
        </div>
        
      ))}
    </div>
  );
}

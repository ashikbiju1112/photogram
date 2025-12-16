import { useState } from "react";
import { supabase } from "../../lib/supabase";

export const BanUserModal = ({ userId }: { userId: string }) => {
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");

  const banUser = async () => {
    const bannedUntil = new Date();
    bannedUntil.setDate(bannedUntil.getDate() + days);

    await supabase.from("profiles").update({
      is_banned: true,
      banned_until: bannedUntil.toISOString(),
    }).eq("id", userId);

    await supabase.from("admin_logs").insert({
      action: "BAN_USER",
      target_user_id: userId,
      reason,
    });

    alert("User banned successfully");
  };

  const unbanUser = async () => {
    await supabase.from("profiles").update({
      is_banned: false,
      banned_until: null,
    }).eq("id", userId);

    await supabase.from("admin_logs").insert({
      action: "UNBAN_USER",
      target_user_id: userId,
    });

    alert("User unbanned");
  };

  return (
    <div>
      <input
        type="number"
        value={days}
        onChange={(e) => setDays(+e.target.value)}
        placeholder="Days"
      />
      <input
        type="text"
        placeholder="Reason"
        onChange={(e) => setReason(e.target.value)}
      />
      <button onClick={banUser}>Ban</button>
      <button onClick={unbanUser}>Unban</button>
    </div>
  );
};

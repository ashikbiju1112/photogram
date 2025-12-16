// src/hooks/useBanUser.ts
//import { supabase } from "../integrations/supabase/client";
import { supabase } from "../lib/supabase";

export const useBanUser = () => {
  const banUser = async (
    userId: string,
    reason: string,
    until: string | null = null
  ): Promise<void> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error("Not authenticated");

    await supabase.from("user_bans").insert({
      user_id: userId,
      banned_by: user.id,
      reason,
      banned_until: until,
    });

    await supabase.from("admin_logs").insert({
      action: "BAN_USER",
      target_id: userId,
      metadata: { reason, until },
    });
  };

  const unbanUser = async (userId: string): Promise<void> => {
    await supabase
      .from("user_bans")
      .update({ is_active: false })
      .eq("user_id", userId);

    await supabase.from("admin_logs").insert({
      action: "UNBAN_USER",
      target_id: userId,
    });
  };

  return { banUser, unbanUser };
};

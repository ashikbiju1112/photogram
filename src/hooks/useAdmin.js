import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useAdmin(user) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setIsAdmin(data?.role === "admin");
      });
  }, [user]);

  return isAdmin;
}

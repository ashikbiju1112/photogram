import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function UserSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
  if (!query) {
    setResults([]);
    return;
  }

  const search = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${query}%`)
      .limit(10);

    console.log("SEARCH RESULT:", data, error);

    if (error) {
      console.error("Search error:", error);
      return;
    }

    setResults(data || []);
  };

  search();
}, [query]);

  return (
    <div className="user-search">
      <input
        placeholder="Search users..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {results.map((profile) => (
  <button
    key={profile.id}
    className="user-result"
    onClick={() => onSelect(profile)}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      padding: 8,
      border: "none",
      background: "transparent",
      cursor: "pointer",
    }}
  >
    <img
  src={profile.avatar_url || "/avatar.png"}
  onError={(e) => {
    e.currentTarget.src = "/avatar.png";
  }}
  width={32}
  height={32}
  style={{
    borderRadius: "50%",
    objectFit: "cover",
    background: "#ddd",
  }}
/>

    <span>{profile.username}</span>
  </button>
))}

    </div>
  );
}

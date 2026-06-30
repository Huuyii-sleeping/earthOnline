import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function getPreferredTheme(): "light" | "dark" {
  const saved = localStorage.getItem("earth-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const initial = getPreferredTheme();
    setTheme(initial);
    document.documentElement.classList.toggle("light", initial === "light");
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("earth-theme", next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="切换深色/浅色主题"
      title="切换主题"
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 ${
        className ?? ""
      }`}
      style={{
        border: "1px solid var(--glass-border)",
        background: "var(--glass-bg)",
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
      }}
    >
      <Sun
        className="absolute h-4 w-4 transition-all duration-300"
        style={{
          opacity: theme === "light" ? 1 : 0,
          transform: theme === "light" ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.5)",
          color: "var(--foreground)",
        }}
      />
      <Moon
        className="absolute h-4 w-4 transition-all duration-300"
        style={{
          opacity: theme === "dark" ? 1 : 0,
          transform: theme === "dark" ? "rotate(0deg) scale(1)" : "rotate(90deg) scale(0.5)",
          color: "var(--foreground)",
        }}
      />
    </button>
  );
}

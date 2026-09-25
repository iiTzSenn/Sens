import { copy } from "../../shared/i18n";

export const t = copy({
  en: {
    working: "Working…",
    writing: "Writing…",
    waiting: "Waiting for your answer",
    sending: "Sending…",
    stopping: "Stopping…",
    noWorktree: (reason: string) => `Couldn’t create the worktree: ${reason}. If you send again, Claude will work in the project folder.`,
  },
  es: {
    working: "Trabajando…",
    writing: "Escribiendo…",
    waiting: "Esperando tu respuesta",
    sending: "Enviando…",
    stopping: "Parando…",
    noWorktree: (reason: string) => `No pude crear el worktree: ${reason}. Si vuelves a enviar, Claude trabajará en la carpeta del proyecto.`,
  },
  fr: {
    working: "Travail en cours…",
    writing: "Rédaction…",
    waiting: "En attente de votre réponse",
    sending: "Envoi…",
    stopping: "Arrêt…",
    noWorktree: (reason: string) => `Impossible de créer le worktree : ${reason}. Si vous renvoyez le message, Claude travaillera dans le dossier du projet.`,
  },
  de: {
    working: "Arbeitet…",
    writing: "Schreibt…",
    waiting: "Wartet auf deine Antwort",
    sending: "Wird gesendet…",
    stopping: "Wird gestoppt…",
    noWorktree: (reason: string) => `Der Worktree ließ sich nicht erstellen: ${reason}. Wenn du erneut sendest, arbeitet Claude im Projektordner.`,
  },
  ja: {
    working: "作業中…",
    writing: "作成中…",
    waiting: "回答を待っています",
    sending: "送信中…",
    stopping: "停止中…",
    noWorktree: (reason: string) => `ワークツリーを作成できませんでした: ${reason}。もう一度送信すると、Claude はプロジェクトフォルダーで作業します。`,
  },
  zh: {
    working: "正在处理…",
    writing: "正在撰写…",
    waiting: "等待你的回答",
    sending: "正在发送…",
    stopping: "正在停止…",
    noWorktree: (reason: string) => `无法创建工作树：${reason}。再次发送后，Claude 将在项目文件夹中工作。`,
  },
});

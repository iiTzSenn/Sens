import { copy } from "../../shared/i18n";

export const t = copy({
  en: {
    question: "Has a question for you.",
    plan: "Has a plan for you to review.",
    permission: (what: string) => `Needs your permission: ${what}`,
    finished: "Finished.",
    finishedBadly: "Finished with an error.",
    failed: "Stopped because of an error.",
  },
  es: {
    question: "Tiene una pregunta para ti.",
    plan: "Tiene un plan para que lo revises.",
    permission: (what: string) => `Necesita tu permiso: ${what}`,
    finished: "Ha terminado.",
    finishedBadly: "Terminó con un error.",
    failed: "Se paró por un error.",
  },
  fr: {
    question: "Une question pour vous.",
    plan: "Un plan à examiner.",
    permission: (what: string) => `Demande votre autorisation : ${what}`,
    finished: "Terminé.",
    finishedBadly: "Terminé avec une erreur.",
    failed: "Arrêté à cause d’une erreur.",
  },
  de: {
    question: "Hat eine Frage an dich.",
    plan: "Hat einen Plan, den du prüfen kannst.",
    permission: (what: string) => `Bittet um deine Erlaubnis: ${what}`,
    finished: "Fertig.",
    finishedBadly: "Mit einem Fehler beendet.",
    failed: "Wegen eines Fehlers angehalten.",
  },
  ja: {
    question: "質問があります。",
    plan: "確認してほしい計画があります。",
    permission: (what: string) => `権限が必要です: ${what}`,
    finished: "完了しました。",
    finishedBadly: "エラーで終了しました。",
    failed: "エラーのため停止しました。",
  },
  zh: {
    question: "有个问题要问你。",
    plan: "有一份计划等你审阅。",
    permission: (what: string) => `需要你的权限：${what}`,
    finished: "已完成。",
    finishedBadly: "结束时出现错误。",
    failed: "因错误而停止。",
  },
});

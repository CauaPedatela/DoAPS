/**
 * Cálculo de horário do agendador, isolado para ser testável.
 *
 * Fica fora do daemon.ts de propósito: aquele arquivo executa ao ser
 * importado, então um teste que o importasse iniciaria o agendador.
 */

/** Próxima ocorrência de HH:MM no fuso local. Se já passou hoje, é amanhã. */
export function proximaExecucao(hora: string, agora = new Date()): Date {
  const [h, m] = hora.split(':').map(Number);
  const alvo = new Date(agora);
  alvo.setHours(h ?? 7, m ?? 20, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

export function formatarEspera(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'menos de 1min';
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h${String(min % 60).padStart(2, '0')}min` : `${min}min`;
}

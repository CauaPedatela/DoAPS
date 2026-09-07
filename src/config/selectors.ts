/**
 * Todos os seletores do Moodle vivem aqui.
 *
 * Quando a UniEVANGÉLICA atualizar o Moodle e algo quebrar, o conserto é
 * neste arquivo — não espalhado por dez.
 *
 * ✓ = confirmado ao vivo contra avagrad.unievangelica.edu.br
 * ? = derivado da estrutura padrão do Moodle, a confirmar com sessão logada
 */
export const S = {
  login: {
    username: '#username',        // ✓
    password: '#password',        // ✓
    submit: '#loginbtn',          // ✓
    token: 'input[name="logintoken"]', // ✓
    error: '#loginerrormessage, .alert-danger', // ✓
  },

  courses: {
    // /my/courses.php
    card: '[data-region="course-content"], .course-info-container',
    link: 'a[href*="/course/view.php?id="]',
  },

  course: {
    // Barra lateral do curso (drawer de índice)
    sidebar: '#courseindex, [data-region="course-index"]',
    sidebarLink: '#courseindex a[href*="/mod/"], [data-region="course-index"] a[href*="/mod/"]',
    sidebarItem: '[data-for="cmitem"]',
  },

  quiz: {
    // /mod/quiz/view.php?id=<cmid>
    startButton: 'form[action*="startattempt.php"] button, #id_submitbutton', // ?
    continueButton: 'a:has-text("Continuar")',                                // ?
    infoTable: '.quizattemptsummary, .quizinfo, table.generaltable',           // ?

    // /mod/quiz/attempt.php
    question: 'div.que',                                    // ?
    questionText: '.qtext',                                 // ?
    answerBlock: '.answer',                                 // ?
    answerRow: '.answer > div[class^="r"]',                 // ?
    essayTextarea: '.qtype_essay textarea',                 // ?
    tinymceFrame: 'iframe[id$="_ifr"]',                     // ?
    shortAnswer: '.qtype_shortanswer input[type="text"]',   // ?

    nextPage: 'input[name="next"], button[name="next"]',    // ?
    finishAttempt: 'a:has-text("Finalizar tentativa"), input[name="next"]', // ?

    // /mod/quiz/summary.php
    submitAll: 'button:has-text("Enviar tudo e terminar"), input[value*="Enviar tudo"]', // ?
    confirmModal: '.modal-dialog button:has-text("Enviar tudo e terminar")',             // ?
  },
} as const;

/** Reconhece "APS 05 - Atividade Prática Supervisionada" na barra lateral. */
export const APS_PATTERN = /^\s*APS\s*0*(\d+)\b/i;

export const PATHS = {
  login: '/login/index.php',
  myCourses: '/my/courses.php',
  course: (id: number) => `/course/view.php?id=${id}`,
  quizView: (cmid: number) => `/mod/quiz/view.php?id=${cmid}`,
  quizSummary: (attempt: number) => `/mod/quiz/summary.php?attempt=${attempt}`,
} as const;

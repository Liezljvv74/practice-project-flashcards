/* Flashcards - a small study tool.
   Cards live in localStorage so the deck survives a reload. */

(function () {
  'use strict';

  var STORAGE_KEY = 'flashcards.deck.v1';

  // How long the green "Correct!" block stays up before the next card.
  var CORRECT_PAUSE_MS = 1000;

  var STATUS_LABEL = {
    new: 'Not reviewed',
    known: 'Known',
    learning: 'Still learning'
  };

  /* ---- State ---- */

  var deck = [];          // [{ id, question, answer, status }]
  var editingId = null;   // card currently being edited in place
  // answerState: 'idle' | 'correct' | 'wrong' | 'revealed'
  var review = {
    active: false,
    order: [],
    index: 0,
    flipped: false,
    marks: {},          // card id -> status set during this run
    correct: 0,
    answerState: 'idle'
  };

  var correctTimer = null;   // pending auto-advance after a correct answer

  /* ---- Elements ---- */

  function el(id) {
    return document.getElementById(id);
  }

  var addForm = el('add-form');
  var questionInput = el('question-input');
  var answerInput = el('answer-input');
  var addError = el('add-error');

  var deckCount = el('deck-count');
  var emptyState = el('empty-state');
  var cardList = el('card-list');
  var startReviewBtn = el('start-review');

  var reviewEl = el('review');
  var reviewStage = el('review-stage');
  var reviewDone = el('review-done');
  var reviewProgress = el('review-progress');
  var reviewSummary = el('review-summary');
  var flashcardEl = el('flashcard');
  var flashcardSide = el('flashcard-side');
  var flashcardText = el('flashcard-text');

  var answerBlock = el('answer-block');
  var answerForm = el('answer-form');
  var answerGuess = el('answer-guess');
  var answerFeedback = el('answer-feedback');
  var answerMessage = el('answer-message');
  var answerRetry = el('answer-retry');

  var prevCardBtn = el('prev-card');
  var nextCardBtn = el('next-card');

  /* ---- Storage ---- */

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (c) {
          return c && typeof c.question === 'string' && typeof c.answer === 'string';
        })
        .map(function (c) {
          return {
            id: c.id ? String(c.id) : makeId(),
            question: c.question,
            answer: c.answer,
            status: STATUS_LABEL[c.status] ? c.status : 'new'
          };
        });
    } catch (err) {
      console.warn('Could not read the saved deck:', err);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    } catch (err) {
      console.warn('Could not save the deck:', err);
    }
  }

  function findCard(id) {
    for (var i = 0; i < deck.length; i++) {
      if (deck[i].id === id) return deck[i];
    }
    return null;
  }

  /* ---- Deck list ---- */

  function renderDeck() {
    cardList.textContent = '';
    deckCount.textContent = deck.length ? '(' + deck.length + ')' : '';
    emptyState.hidden = deck.length > 0;
    startReviewBtn.disabled = deck.length === 0;

    deck.forEach(function (card) {
      cardList.appendChild(card.id === editingId ? buildEditRow(card) : buildCardRow(card));
    });
  }

  function buildCardRow(card) {
    var li = document.createElement('li');
    li.className = 'card';

    var main = document.createElement('div');
    main.className = 'card-main';

    var q = document.createElement('p');
    q.className = 'card-q';
    q.textContent = card.question;

    var a = document.createElement('p');
    a.className = 'card-a';
    a.textContent = card.answer;

    main.appendChild(q);
    main.appendChild(a);

    var side = document.createElement('div');
    side.className = 'card-side';

    var badge = document.createElement('span');
    badge.className = 'badge' + (card.status === 'new' ? '' : ' badge-' + card.status);
    badge.textContent = STATUS_LABEL[card.status];

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function () {
      editingId = card.id;
      renderDeck();
      var input = el('edit-q-' + card.id);
      if (input) input.focus();
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-small btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      if (!window.confirm('Delete this card?\n\n' + card.question)) return;
      deck = deck.filter(function (c) {
        return c.id !== card.id;
      });
      if (editingId === card.id) editingId = null;
      save();
      renderDeck();
    });

    side.appendChild(badge);
    side.appendChild(editBtn);
    side.appendChild(deleteBtn);

    li.appendChild(main);
    li.appendChild(side);
    return li;
  }

  function buildEditRow(card) {
    var li = document.createElement('li');
    li.className = 'card';

    var form = document.createElement('form');
    form.className = 'edit-form';
    form.noValidate = true;

    var qField = buildField('edit-q-' + card.id, 'Question', card.question);
    var aField = buildField('edit-a-' + card.id, 'Answer', card.answer);

    var error = document.createElement('p');
    error.className = 'error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    var actions = document.createElement('div');
    actions.className = 'edit-actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary btn-small';
    saveBtn.textContent = 'Save';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () {
      editingId = null;
      renderDeck();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.appendChild(qField.field);
    form.appendChild(aField.field);
    form.appendChild(error);
    form.appendChild(actions);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var q = qField.input.value.trim();
      var a = aField.input.value.trim();
      if (!q || !a) {
        error.textContent = 'A card needs both a question and an answer.';
        error.hidden = false;
        return;
      }
      card.question = q;
      card.answer = a;
      editingId = null;
      save();
      renderDeck();
    });

    li.appendChild(form);
    return li;
  }

  function buildField(id, labelText, value) {
    var field = document.createElement('div');
    field.className = 'field';

    var label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;

    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.value = value;
    input.autocomplete = 'off';

    field.appendChild(label);
    field.appendChild(input);
    return { field: field, input: input };
  }

  /* ---- Add a card ---- */

  addForm.addEventListener('submit', function (event) {
    event.preventDefault();

    var question = questionInput.value.trim();
    var answer = answerInput.value.trim();

    if (!question || !answer) {
      addError.textContent = 'A card needs both a question and an answer.';
      addError.hidden = false;
      (question ? answerInput : questionInput).focus();
      return;
    }

    addError.hidden = true;
    deck.push({ id: makeId(), question: question, answer: answer, status: 'new' });
    save();

    questionInput.value = '';
    answerInput.value = '';
    questionInput.focus();
    renderDeck();
  });

  /* ---- Review mode ---- */

  function currentCard() {
    return findCard(review.order[review.index]);
  }

  function clearCorrectTimer() {
    if (correctTimer !== null) {
      window.clearTimeout(correctTimer);
      correctTimer = null;
    }
  }

  function startReview() {
    if (!deck.length) return;
    clearCorrectTimer();
    review.active = true;
    review.correct = 0;
    review.order = deck.map(function (c) {
      return c.id;
    });
    review.index = 0;
    review.flipped = false;
    review.marks = {};
    resetAnswer();
    reviewEl.hidden = false;
    renderReview();
    focusAnswer();
  }

  /* ---- Typed answer ---- */

  /* --- answer matching (pure functions, kept together for testing) --- */

  // Punctuation clinging to the outside of a word. Deliberately a fixed
  // list rather than \W, so accented letters survive: a \W-based strip
  // would turn "cafe" with an accent into "caf".
  var EDGE_PUNCTUATION = /^[.,!?;:'"()\[\]{}\-]+|[.,!?;:'"()\[\]{}\-]+$/g;

  // Break text into a sorted list of bare words. Sorting is what makes
  // word order irrelevant; splitting on /\s+/ makes spacing irrelevant.
  function answerWords(text) {
    return String(text)
      .toLowerCase()
      .split(/\s+/)
      .map(function (word) {
        return word.replace(EDGE_PUNCTUATION, '');
      })
      .filter(function (word) {
        return word.length > 0;
      })
      .sort();
  }

  // Correct when the guess holds exactly the same words as the answer.
  // Any order, any spacing, any capitals - but every word must be
  // there, and no extras.
  function isCorrect(guess, answer) {
    var typed = answerWords(guess);
    var wanted = answerWords(answer);
    return typed.length === wanted.length && typed.join(' ') === wanted.join(' ');
  }

  /* --- end answer matching --- */

  function resetAnswer() {
    review.answerState = 'idle';
    answerGuess.value = '';
  }

  function focusAnswer() {
    if (review.active && review.answerState === 'idle' && currentCard()) {
      answerGuess.focus();
    }
  }

  function renderAnswerBlock(card) {
    var state = review.answerState;

    answerBlock.classList.toggle('is-correct', state === 'correct');
    answerBlock.classList.toggle('is-wrong', state === 'wrong' || state === 'revealed');

    answerForm.hidden = state !== 'idle';
    answerFeedback.hidden = state === 'idle';
    answerRetry.hidden = state !== 'wrong';

    if (state === 'correct') {
      answerMessage.textContent = review.index >= review.order.length - 1
        ? 'Correct! Marked as known. That was the last card.'
        : 'Correct! Marked as known - moving to the next card...';
    } else if (state === 'wrong') {
      answerMessage.textContent = 'Do you want to try again?';
    } else if (state === 'revealed') {
      answerMessage.textContent = 'The correct answer is: ' + card.answer;
    }
  }

  answerForm.addEventListener('submit', function (event) {
    event.preventDefault();

    var card = currentCard();
    if (!card) return;

    var guess = answerGuess.value.trim();
    if (!guess) {
      answerGuess.focus();
      return;
    }

    if (isCorrect(guess, card.answer)) {
      review.answerState = 'correct';
      review.flipped = true;   // they earned the answer side
      review.correct++;
      recordMark(card, 'known');   // getting it right counts as knowing it
      renderReview();
      // Hold the green block long enough to read, then move on.
      clearCorrectTimer();
      correctTimer = window.setTimeout(advanceAfterCorrect, CORRECT_PAUSE_MS);
      return;
    }

    review.answerState = 'wrong';
    renderReview();
  });

  function advanceAfterCorrect() {
    correctTimer = null;
    if (!review.active || review.answerState !== 'correct') return;

    if (review.index < review.order.length - 1) {
      goTo(review.index + 1);
      return;
    }

    // That was the last card, so finish the run.
    review.index++;
    review.flipped = false;
    resetAnswer();
    renderReview();
  }

  el('retry-yes').addEventListener('click', function () {
    resetAnswer();
    renderReview();
    focusAnswer();
  });

  el('retry-show').addEventListener('click', function () {
    review.answerState = 'revealed';
    review.flipped = true;
    renderReview();
  });

  function exitReview() {
    clearCorrectTimer();
    review.active = false;
    reviewEl.hidden = true;
    renderDeck();
    startReviewBtn.focus();
  }

  function renderReview() {
    var card = currentCard();

    if (!card) {
      reviewStage.hidden = true;
      reviewDone.hidden = false;
      reviewProgress.textContent = 'Done';
      reviewSummary.textContent =
        'You answered ' + review.correct + ' correctly. ' +
        countMarks('known') + ' marked as known, ' +
        countMarks('learning') + ' as still learning.';
      return;
    }

    reviewStage.hidden = false;
    reviewDone.hidden = true;
    reviewProgress.textContent = 'Card ' + (review.index + 1) + ' of ' + review.order.length;
    flashcardSide.textContent = review.flipped ? 'Answer' : 'Question';
    flashcardText.textContent = review.flipped ? card.answer : card.question;
    flashcardEl.classList.toggle('is-flipped', review.flipped);
    prevCardBtn.disabled = review.index === 0;
    nextCardBtn.disabled = review.index >= review.order.length - 1;
    renderAnswerBlock(card);
  }

  // Move between cards without marking them. Each move starts the new
  // card fresh: question side up, answer box empty.
  function goTo(index) {
    if (index < 0 || index >= review.order.length) return;
    clearCorrectTimer();
    review.index = index;
    review.flipped = false;
    resetAnswer();
    renderReview();
    focusAnswer();
  }

  function flip() {
    if (!currentCard()) return;
    review.flipped = !review.flipped;
    renderReview();
  }

  // Record a status against a card. Marking the same card twice in one
  // run overwrites the earlier mark rather than counting it again.
  function recordMark(card, status) {
    card.status = status;
    review.marks[card.id] = status;
    save();
  }

  function countMarks(status) {
    var total = 0;
    Object.keys(review.marks).forEach(function (id) {
      if (review.marks[id] === status) total++;
    });
    return total;
  }

  function mark(status) {
    var card = currentCard();
    if (!card) return;

    clearCorrectTimer();
    recordMark(card, status);

    review.index++;
    review.flipped = false;
    resetAnswer();
    renderReview();
    focusAnswer();
  }

  startReviewBtn.addEventListener('click', startReview);
  el('exit-review').addEventListener('click', exitReview);
  el('review-close').addEventListener('click', exitReview);
  el('review-again').addEventListener('click', startReview);
  el('mark-known').addEventListener('click', function () {
    mark('known');
  });
  el('mark-learning').addEventListener('click', function () {
    mark('learning');
  });
  flashcardEl.addEventListener('click', flip);

  prevCardBtn.addEventListener('click', function () {
    goTo(review.index - 1);
  });
  nextCardBtn.addEventListener('click', function () {
    goTo(review.index + 1);
  });

  document.addEventListener('keydown', function (event) {
    if (!review.active) return;

    if (event.key === 'Escape') {
      exitReview();
      return;
    }

    // While the answer box has focus, let every key type normally -
    // otherwise Space, K and L could never be part of an answer.
    if (event.target && event.target.tagName === 'INPUT') return;

    if (!reviewDone.hidden) return;

    if (event.key === ' ' || event.key === 'Spacebar') {
      // Stops the page scrolling, and stops a focused button firing on space.
      event.preventDefault();
      flip();
    } else if (event.key === 'Enter' && event.target === flashcardEl) {
      event.preventDefault();
      flip();
    } else if (event.key === 'k' || event.key === 'K') {
      mark('known');
    } else if (event.key === 'l' || event.key === 'L') {
      mark('learning');
    }
  });

  /* ---- Start ---- */

  deck = load();
  renderDeck();
})();

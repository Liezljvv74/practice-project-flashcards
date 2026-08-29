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
  var selectedId = null;  // card the keyboard is pointing at
  var searchTerm = '';    // text typed into the search box
  // phase:       'choice' | 'card' | 'done'
  // answerState: 'idle' | 'correct' | 'wrong' | 'revealed'
  var review = {
    active: false,
    phase: 'choice',
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

  var searchInput = el('search-input');
  var importFile = el('import-file');
  var printArea = el('print-area');

  var deckCount = el('deck-count');
  var emptyState = el('empty-state');
  var cardList = el('card-list');
  var listHint = el('list-hint');
  var startReviewBtn = el('start-review');

  var reviewEl = el('review');
  var reviewChoice = el('review-choice');
  var chooseAllBtn = el('choose-all');
  var choosePendingBtn = el('choose-pending');
  var choiceNote = el('choice-note');
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

  // Turn whatever was stored or imported into cards we can trust.
  // Returns null if it is not a list of cards at all.
  function sanitizeDeck(parsed) {
    if (!Array.isArray(parsed)) return null;
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
  }

  function parseDeck(text) {
    try {
      return sanitizeDeck(JSON.parse(text));
    } catch (err) {
      return null;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return (raw ? sanitizeDeck(JSON.parse(raw)) : []) || [];
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

  // The cards the search box is currently letting through.
  function visibleCards() {
    if (!searchTerm) return deck;
    var needle = searchTerm.toLowerCase();
    return deck.filter(function (c) {
      return (c.question + ' ' + c.answer).toLowerCase().indexOf(needle) !== -1;
    });
  }

  function renderDeck() {
    var cards = visibleCards();

    cardList.textContent = '';
    startReviewBtn.disabled = deck.length === 0;
    listHint.hidden = cards.length === 0;

    if (!deck.length) {
      deckCount.textContent = '';
      emptyState.textContent = 'No cards yet. Add your first one above.';
      emptyState.hidden = false;
    } else if (!cards.length) {
      deckCount.textContent = '(0 of ' + deck.length + ')';
      emptyState.textContent = 'No cards match "' + searchTerm + '".';
      emptyState.hidden = false;
    } else {
      deckCount.textContent = cards.length === deck.length
        ? '(' + deck.length + ')'
        : '(' + cards.length + ' of ' + deck.length + ')';
      emptyState.hidden = true;
    }

    cards.forEach(function (card) {
      cardList.appendChild(card.id === editingId ? buildEditRow(card) : buildCardRow(card));
    });
  }

  // Take a card out of the deck, keeping a neighbour selected so the
  // arrow keys still have somewhere to stand.
  function removeCard(id) {
    var position = -1;
    visibleCards().forEach(function (c, i) {
      if (c.id === id) position = i;
    });

    deck = deck.filter(function (c) {
      return c.id !== id;
    });
    if (editingId === id) editingId = null;

    if (selectedId === id) {
      var remaining = visibleCards();
      var neighbour = remaining[position] || remaining[position - 1];
      selectedId = neighbour ? neighbour.id : null;
    }

    save();
    renderDeck();
  }

  function askThenRemove(card) {
    if (!window.confirm('Delete this card?\n\n' + card.question)) return;
    removeCard(card.id);
  }

  function moveSelection(step) {
    var cards = visibleCards();
    if (!cards.length) return;

    var index = -1;
    cards.forEach(function (c, i) {
      if (c.id === selectedId) index = i;
    });

    var next;
    if (index === -1) {
      next = step > 0 ? 0 : cards.length - 1;
    } else {
      next = Math.min(Math.max(index + step, 0), cards.length - 1);
    }

    selectedId = cards[next].id;
    renderDeck();

    var row = cardList.querySelector('.is-selected');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  function deleteSelected() {
    var card = findCard(selectedId);
    if (card) askThenRemove(card);
  }

  function buildCardRow(card) {
    var li = document.createElement('li');
    li.className = 'card' + (card.id === selectedId ? ' is-selected' : '');

    // Clicking the row selects it, but a click on Edit or Delete is
    // meant for that button, not for the selection.
    li.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('button')) return;
      selectedId = card.id;
      renderDeck();
    });

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
      askThenRemove(card);
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

  /* ---- Search ---- */

  searchInput.addEventListener('input', function () {
    searchTerm = searchInput.value.trim();
    renderDeck();
  });

  /* ---- Export and backup ---- */

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function downloadFile(text, filename, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Let the download start before the URL is thrown away.
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // Spreadsheet rule: wrap every field in quotes and double any quote
  // inside it, so commas and line breaks in a card cannot break a row.
  function csvField(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    if (!deck.length) return;

    var rows = [['Question', 'Answer', 'Status']];
    deck.forEach(function (card) {
      rows.push([card.question, card.answer, STATUS_LABEL[card.status]]);
    });

    var csv = rows.map(function (row) {
      return row.map(csvField).join(',');
    }).join('\r\n');

    // The BOM is what makes Excel read this as UTF-8, so accents survive.
    downloadFile('﻿' + csv, 'flashcards-' + stamp() + '.csv', 'text/csv;charset=utf-8');
  }

  function exportJson() {
    if (!deck.length) return;
    downloadFile(
      JSON.stringify(deck, null, 2),
      'flashcards-backup-' + stamp() + '.json',
      'application/json'
    );
  }

  function printRow(values, cellTag) {
    var tr = document.createElement('tr');
    values.forEach(function (value) {
      var cell = document.createElement(cellTag);
      cell.textContent = value;
      tr.appendChild(cell);
    });
    return tr;
  }

  // There is no PDF library here, so the PDF comes from the browser's
  // own print dialog: choose "Save as PDF" as the destination.
  function exportPdf() {
    if (!deck.length) return;

    printArea.textContent = '';

    var heading = document.createElement('h1');
    heading.textContent = 'Flashcards';

    var meta = document.createElement('p');
    meta.className = 'print-meta';
    meta.textContent = deck.length + ' cards, exported ' + stamp();

    var table = document.createElement('table');
    var head = document.createElement('thead');
    var body = document.createElement('tbody');

    head.appendChild(printRow(['Question', 'Answer', 'Status'], 'th'));
    deck.forEach(function (card) {
      body.appendChild(printRow([card.question, card.answer, STATUS_LABEL[card.status]], 'td'));
    });

    table.appendChild(head);
    table.appendChild(body);
    printArea.appendChild(heading);
    printArea.appendChild(meta);
    printArea.appendChild(table);

    window.print();
  }

  /* ---- Restore from a file ---- */

  function importDeck(text) {
    var imported = parseDeck(text);

    if (imported === null) {
      window.alert('That file could not be read as a flashcard backup.\n\n' +
        'Pick a .json file saved by the Backup button.');
      return;
    }

    if (!imported.length) {
      window.alert('That backup has no cards in it, so nothing was changed.');
      return;
    }

    var question = deck.length
      ? 'Replace the current ' + deck.length + ' cards with ' +
        imported.length + ' cards from the file?\n\nThis cannot be undone.'
      : 'Load ' + imported.length + ' cards from the file?';

    if (!window.confirm(question)) return;

    deck = imported;
    selectedId = null;
    editingId = null;
    searchTerm = '';
    searchInput.value = '';
    save();
    renderDeck();
  }

  el('export-csv').addEventListener('click', exportCsv);
  el('export-pdf').addEventListener('click', exportPdf);
  el('export-json').addEventListener('click', exportJson);

  el('import-json').addEventListener('click', function () {
    importFile.value = '';   // so picking the same file twice still fires
    importFile.click();
  });

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      importDeck(reader.result);
    };
    reader.onerror = function () {
      window.alert('That file could not be opened.');
    };
    reader.readAsText(file);
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

  // Everything not yet settled: still learning, plus never reviewed.
  function pendingCards() {
    return deck.filter(function (c) {
      return c.status !== 'known';
    });
  }

  // Opening the overlay only asks what to review. Nothing starts until
  // one of the two options is chosen.
  function openReview() {
    if (!deck.length) return;
    clearCorrectTimer();
    review.active = true;
    review.phase = 'choice';
    reviewEl.hidden = false;
    renderReview();
  }

  // scope is 'all' or 'pending'.
  function beginReview(scope) {
    var cards = scope === 'pending' ? pendingCards() : deck;
    if (!cards.length) return;

    clearCorrectTimer();
    review.order = cards.map(function (c) {
      return c.id;
    });
    review.index = 0;
    review.flipped = false;
    review.marks = {};
    review.correct = 0;
    review.phase = 'card';
    resetAnswer();
    renderReview();
    focusAnswer();
  }

  /* ---- Typed answer ---- */

  /* --- answer matching (pure functions, kept together for testing) --- */

  // Everything treated as punctuation. Deliberately a fixed list rather
  // than \W, so accented letters survive: a \W-based strip would turn
  // "cafe" with an accent into "caf".
  var PUNCTUATION = /['‘’"“”.,;:!?()\[\]{}\/\\&+–—\-]/g;

  // Ignored when comparing, so a list written "a, b and c" matches the
  // same list written "a, b, c" or "a b c".
  var FILLER_WORDS = ['and'];

  // Break text into a sorted list of bare words. Sorting is what makes
  // word order irrelevant; splitting on /\s+/ makes spacing irrelevant.
  function answerWords(text, punctuationBecomes) {
    return String(text)
      .toLowerCase()
      .replace(PUNCTUATION, punctuationBecomes)
      .split(/\s+/)
      .filter(function (word) {
        return word.length > 0 && FILLER_WORDS.indexOf(word) === -1;
      })
      .sort();
  }

  function sameWords(guess, answer, punctuationBecomes) {
    var typed = answerWords(guess, punctuationBecomes);
    var wanted = answerWords(answer, punctuationBecomes);
    return typed.length > 0 &&
      typed.length === wanted.length &&
      typed.join(' ') === wanted.join(' ');
  }

  // Correct when the guess holds the same words as the answer: any
  // order, any spacing, any capitals, any punctuation - but every word
  // must be there and there may be no extras.
  //
  // Punctuation is read two ways and either reading counts. Treated as
  // a gap it lets "well-known" match "well known"; treated as nothing
  // it lets "U.S.A." match "USA".
  function isCorrect(guess, answer) {
    return sameWords(guess, answer, ' ') || sameWords(guess, answer, '');
  }

  /* --- end answer matching --- */

  function resetAnswer() {
    review.answerState = 'idle';
    answerGuess.value = '';
  }

  function focusAnswer() {
    if (review.active && review.phase === 'card' && review.answerState === 'idle' && currentCard()) {
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
    if (!review.active || review.phase !== 'card' || review.answerState !== 'correct') return;

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
    reviewChoice.hidden = review.phase !== 'choice';
    reviewStage.hidden = review.phase !== 'card';
    reviewDone.hidden = review.phase !== 'done';

    if (review.phase === 'choice') {
      renderChoice();
    } else if (review.phase === 'done') {
      renderDone();
    } else {
      renderCard();
    }
  }

  function renderChoice() {
    var pending = pendingCards().length;

    reviewProgress.textContent = '';
    chooseAllBtn.textContent = 'Review all (' + deck.length + ')';
    choosePendingBtn.textContent =
      'Review "still learning" and "not reviewed" only (' + pending + ')';
    choosePendingBtn.disabled = pending === 0;
    choiceNote.textContent = pending === 0
      ? 'Every card is marked known, so there is nothing left to narrow down to.'
      : pending + ' of ' + deck.length +
        ' cards are still learning or not reviewed yet.';
    chooseAllBtn.focus();
  }

  function renderDone() {
    reviewProgress.textContent = 'Done';
    reviewSummary.textContent =
      'You answered ' + review.correct + ' correctly. ' +
      countMarks('known') + ' marked as known, ' +
      countMarks('learning') + ' as still learning.';
  }

  function renderCard() {
    var card = currentCard();

    if (!card) {
      review.phase = 'done';
      renderReview();
      return;
    }

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

  startReviewBtn.addEventListener('click', openReview);
  el('exit-review').addEventListener('click', exitReview);
  el('review-close').addEventListener('click', exitReview);
  el('review-again').addEventListener('click', openReview);   // back to the chooser

  chooseAllBtn.addEventListener('click', function () {
    beginReview('all');
  });
  choosePendingBtn.addEventListener('click', function () {
    beginReview('pending');
  });
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

  function isTyping(target) {
    if (!target) return false;
    return target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable === true;
  }

  /* ---- Keyboard: review mode ---- */

  document.addEventListener('keydown', function (event) {
    if (!review.active) return;

    if (event.key === 'Escape') {
      exitReview();
      return;
    }

    // The rest only make sense while a card is showing.
    if (review.phase !== 'card') return;

    var typing = isTyping(event.target);

    // Tab flips the card wherever the focus happens to be, so it works
    // straight from the answer box. Inside review mode that costs Tab
    // its usual job of moving focus between controls.
    if (event.key === 'Tab') {
      event.preventDefault();
      flip();
      return;
    }

    // Left and right move between cards. With text in the answer box
    // they move the caret instead, which is what those keys are for.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (typing && answerGuess.value.length) return;
      event.preventDefault();
      goTo(review.index + (event.key === 'ArrowRight' ? 1 : -1));
      return;
    }

    // Everything below is a plain character, so it must not fire while
    // an answer is being typed.
    if (typing) return;

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

  /* ---- Keyboard: deck list ---- */

  document.addEventListener('keydown', function (event) {
    if (review.active || editingId) return;

    // Arrow Down out of the search box jumps into the results.
    var fromSearch = event.target === searchInput;
    if (isTyping(event.target) && !(fromSearch && event.key === 'ArrowDown')) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (fromSearch) searchInput.blur();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      deleteSelected();
    }
  });

  /* ---- Start ---- */

  deck = load();
  renderDeck();
})();

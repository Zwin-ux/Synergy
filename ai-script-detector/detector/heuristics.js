(function (root) {
  const App = (root.AIScriptDetector = root.AIScriptDetector || {});
  const Patterns = App.patterns;
  const Stats = App.stats;
  const Text = App.text;

  const COMMON_CAPITALIZED_WORDS = new Set([
    "the",
    "this",
    "that",
    "these",
    "those",
    "it",
    "we",
    "they",
    "he",
    "she",
    "there",
    "here",
    "today",
    "overall",
    "however",
    "meanwhile",
    "ultimately"
  ]);

  App.heuristics = {
    buildContext,
    analyzeRepetition,
    analyzeUniformity,
    analyzeGenericity,
    analyzeScriptTemplates,
    analyzeSpecificityDeficit,
    analyzeBurstiness
  };

  function buildContext(text) {
    const normalizedText = Text.sanitizeInput(text);
    const sentences = Text.splitSentences(normalizedText);
    const paragraphs = Text.splitParagraphs(normalizedText);
    const lowerText = normalizedText.toLowerCase();
    const tokens = Text.tokenize(normalizedText);
    const sentenceRecords = sentences.map((sentence, index) => {
      const sentenceTokens = Text.tokenize(sentence);
      return {
        index,
        sentence,
        lowerSentence: sentence.toLowerCase(),
        tokens: sentenceTokens,
        wordCount: sentenceTokens.length,
        opener: sentenceTokens.slice(0, 3).join(" "),
        shortOpener: sentenceTokens.slice(0, 2).join(" "),
        punctuationEnd: (sentence.match(/[.!?]+$/) || [""])[0]
      };
    });

    return {
      text: normalizedText,
      lowerText,
      tokens,
      paragraphs,
      sentenceRecords,
      sentenceLengths: sentenceRecords.map((record) => record.wordCount),
      paragraphLengths: paragraphs.map((paragraph) => Text.countWords(paragraph)),
      wordCount: tokens.length,
      sentenceCount: sentenceRecords.length,
      paragraphCount: paragraphs.length
    };
  }

  function analyzeRepetition(context) {
    const repeatedOpeners = countMeaningfulOpeners(context.sentenceRecords).filter(
      (entry) => entry.count >= 2
    );
    const openerSentenceHits = repeatedOpeners.reduce((sum, entry) => sum + entry.count, 0);
    const repeatedNgrams = findRepeatedNgrams(context.tokens, Patterns.stopwords, 3)
      .filter((entry) => entry.count >= 3)
      .slice(0, 4);
    const repeatedTransitions = collectTransitionStarts(context.sentenceRecords);
    const transitionHits = repeatedTransitions.reduce((sum, entry) => sum + entry.count, 0);

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (repeatedOpeners.length) {
      const examples = repeatedOpeners
        .slice(0, 2)
        .map((entry) => `"${entry.value}"`)
        .join(", ");
      reasons.push(`Repeated sentence openings appear throughout, including ${examples}.`);

      repeatedOpeners.forEach((entry) => {
        triggers.push({
          category: "repetition",
          label: "Repeated opener",
          evidence: `"${entry.value}" appears ${entry.count} times.`,
          count: entry.count,
          weight: 16 + entry.count * 2,
          examples: [entry.value]
        });
        entry.indexes.forEach((index) => {
          flags.push({
            sentenceIndex: index,
            reason: `Repeats the opener "${entry.value}".`,
            weight: 12
          });
        });
      });
    }

    if (repeatedNgrams.length) {
      const examples = repeatedNgrams
        .slice(0, 2)
        .map((entry) => `"${entry.value}"`)
        .join(", ");
      reasons.push(`Short phrase patterns repeat more than expected, such as ${examples}.`);
      repeatedNgrams.forEach((entry) => {
        triggers.push({
          category: "repetition",
          label: "Repeated phrase",
          evidence: `"${entry.value}" appears ${entry.count} times.`,
          count: entry.count,
          weight: 12 + entry.count,
          examples: [entry.value]
        });
      });
    }

    if (repeatedTransitions.length) {
      const examples = repeatedTransitions
        .slice(0, 2)
        .map((entry) => `"${entry.value}"`)
        .join(", ");
      reasons.push(`Transitional framing is reused heavily, including ${examples}.`);
      repeatedTransitions.forEach((entry) => {
        entry.indexes.forEach((index) => {
          flags.push({
            sentenceIndex: index,
            reason: `Uses the transition "${entry.value}" repeatedly.`,
            weight: 10
          });
        });
      });
    }

    const openerRatio = context.sentenceCount ? openerSentenceHits / context.sentenceCount : 0;
    const ngramSignal = repeatedNgrams.reduce((sum, entry) => sum + (entry.count - 2), 0);
    const rawScore = Stats.clamp(
      openerRatio * 62 + transitionHits * 4 + ngramSignal * 6,
      0,
      100
    );

    return createCategoryResult("repetition", rawScore, reasons, triggers, flags);
  }

  function analyzeUniformity(context) {
    const sentenceCv = Stats.coefficientOfVariation(context.sentenceLengths);
    const paragraphCv = Stats.coefficientOfVariation(context.paragraphLengths);
    const adjacencyDiff =
      context.sentenceLengths.length > 1
        ? averageAdjacentDifference(context.sentenceLengths) /
          Math.max(1, Stats.mean(context.sentenceLengths))
        : 1;
    const similarRuns = findSimilarLengthRuns(context.sentenceLengths);
    const runCoverage = context.sentenceCount
      ? similarRuns.reduce((sum, run) => sum + run.length, 0) / context.sentenceCount
      : 0;

    const sentenceUniformity = Stats.normalizeInverse(sentenceCv, 0.18, 0.7);
    const paragraphUniformity = Stats.normalizeInverse(paragraphCv, 0.2, 1.1);
    const cadenceUniformity = Stats.normalizeInverse(adjacencyDiff, 0.08, 0.48);

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (sentenceUniformity > 0.58 && context.sentenceCount >= 5) {
      reasons.push("Sentence lengths stay unusually consistent across the passage.");
      triggers.push({
        category: "uniformity",
        label: "Consistent sentence length",
        evidence: `Sentence length variation is low (CV ${sentenceCv.toFixed(2)}).`,
        count: context.sentenceCount,
        weight: 18,
        examples: []
      });
    }

    if (paragraphUniformity > 0.62 && context.paragraphCount >= 3) {
      reasons.push("Paragraph sizes cluster tightly instead of varying naturally.");
      triggers.push({
        category: "uniformity",
        label: "Paragraph size uniformity",
        evidence: `Paragraph length variation is low (CV ${paragraphCv.toFixed(2)}).`,
        count: context.paragraphCount,
        weight: 12,
        examples: []
      });
    }

    if (similarRuns.length) {
      reasons.push("Several consecutive sentences land in nearly the same size range.");
      similarRuns.forEach((run) => {
        for (let index = run.start; index < run.start + run.length; index += 1) {
          flags.push({
            sentenceIndex: index,
            reason: "Part of a long run of similarly sized sentences.",
            weight: 9
          });
        }
      });
    }

    const rawScore = Stats.clamp(
      sentenceUniformity * 48 +
        paragraphUniformity * 22 +
        cadenceUniformity * 20 +
        runCoverage * 18,
      0,
      100
    );

    return createCategoryResult("uniformity", rawScore, reasons, triggers, flags);
  }

  function analyzeGenericity(context) {
    const genericPhraseHits = findPhraseHits(context.lowerText, Patterns.genericPhrases);
    const hedgePhraseHits = findPhraseHits(context.lowerText, Patterns.hedgeTerms);
    const vagueWordCount = countSetHits(context.tokens, Patterns.vagueTerms);
    const buzzwordCount = countTermHits(context.lowerText, Patterns.businessBuzzwords);
    const genericDensity =
      context.wordCount > 0 ? (vagueWordCount + buzzwordCount) / context.wordCount : 0;

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (genericPhraseHits.length) {
      const examples = genericPhraseHits
        .slice(0, 2)
        .map((entry) => `"${entry.value}"`)
        .join(", ");
      reasons.push(`Stock filler phrasing appears, including ${examples}.`);
      genericPhraseHits.forEach((entry) => {
        triggers.push({
          category: "genericity",
          label: "Stock phrase",
          evidence: `"${entry.value}" appears ${entry.count} times.`,
          count: entry.count,
          weight: 14 + entry.count * 2,
          examples: [entry.value]
        });
      });
    }

    if (genericDensity > 0.065) {
      reasons.push("Generic business and marketing language is unusually dense.");
      triggers.push({
        category: "genericity",
        label: "Buzzword density",
        evidence: `${vagueWordCount + buzzwordCount} generic terms appear across ${context.wordCount} words.`,
        count: vagueWordCount + buzzwordCount,
        weight: 18,
        examples: []
      });
    }

    if (hedgePhraseHits.length) {
      reasons.push("The text leans on broad hedging language rather than direct claims.");
    }

    context.sentenceRecords.forEach((record) => {
      const sentencePhraseHits = findPhraseHits(record.lowerSentence, Patterns.genericPhrases);
      const sentenceBuzzwords =
        countSetHits(record.tokens, Patterns.vagueTerms) +
        countTermHits(record.lowerSentence, Patterns.businessBuzzwords);

      if (sentencePhraseHits.length || sentenceBuzzwords >= 3) {
        const firstPhrase = sentencePhraseHits[0]?.value;
        flags.push({
          sentenceIndex: record.index,
          reason: firstPhrase
            ? `Contains stock phrase "${firstPhrase}".`
            : "Stacks several generic or promotional terms together.",
          weight: firstPhrase ? 14 : 9
        });
      }
    });

    const rawScore = Stats.clamp(
      genericPhraseHits.reduce((sum, entry) => sum + entry.count * 11, 0) +
        hedgePhraseHits.reduce((sum, entry) => sum + entry.count * 5, 0) +
        Stats.normalizeRange(genericDensity, 0.025, 0.1) * 38,
      0,
      100
    );

    return createCategoryResult("genericity", rawScore, reasons, triggers, flags);
  }

  function analyzeScriptTemplates(context) {
    const introSentences = context.sentenceRecords.slice(0, 3);
    const outroSentences = context.sentenceRecords.slice(-4);
    const introHits = collectSentencePhraseHits(introSentences, Patterns.scriptIntroPhrases);
    const ctaHits = collectSentencePhraseHits(outroSentences, Patterns.callToActionPhrases);
    const recapHits = collectSentencePhraseHits(outroSentences, Patterns.recapPhrases);
    const hookHits = collectSentencePhraseHits(context.sentenceRecords, [
      "here's why",
      "let's dive in",
      "today we're going to",
      "today i want to"
    ]);

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (introHits.length) {
      reasons.push("The opening follows a familiar script or explainer-template setup.");
      introHits.forEach((hit) => {
        triggers.push({
          category: "script_template",
          label: "Script intro",
          evidence: `Sentence ${hit.sentenceIndex + 1} uses "${hit.phrase}".`,
          count: 1,
          weight: 16,
          examples: [hit.phrase]
        });
        flags.push({
          sentenceIndex: hit.sentenceIndex,
          reason: `Uses a familiar scripted opener: "${hit.phrase}".`,
          weight: 15
        });
      });
    }

    if (ctaHits.length) {
      reasons.push("The ending uses creator-style call-to-action language.");
      ctaHits.forEach((hit) => {
        triggers.push({
          category: "script_template",
          label: "Call to action",
          evidence: `Sentence ${hit.sentenceIndex + 1} uses "${hit.phrase}".`,
          count: 1,
          weight: 18,
          examples: [hit.phrase]
        });
        flags.push({
          sentenceIndex: hit.sentenceIndex,
          reason: `Contains a CTA phrase: "${hit.phrase}".`,
          weight: 16
        });
      });
    }

    if (recapHits.length) {
      reasons.push("The piece includes recap framing common in templated scripts.");
      recapHits.forEach((hit) => {
        flags.push({
          sentenceIndex: hit.sentenceIndex,
          reason: `Uses recap phrasing: "${hit.phrase}".`,
          weight: 11
        });
      });
    }

    const hasIntroAndOutro = introHits.length && (ctaHits.length || recapHits.length);
    const rawScore = Stats.clamp(
      introHits.length * 20 +
        ctaHits.length * 22 +
        recapHits.length * 10 +
        hookHits.length * 6 +
        (hasIntroAndOutro ? 12 : 0),
      0,
      100
    );

    return createCategoryResult("script_template", rawScore, reasons, triggers, flags);
  }

  function analyzeSpecificityDeficit(context) {
    const concreteSignals = countConcreteSignals(context.text);
    const abstractCount = countSetHits(context.tokens, Patterns.abstractTerms);
    const concreteDensity = context.wordCount ? concreteSignals.total / context.wordCount : 0;
    const abstractDensity = context.wordCount ? abstractCount / context.wordCount : 0;
    const sentenceSpecificityRatio = context.sentenceCount
      ? concreteSignals.sentencesWithConcrete / context.sentenceCount
      : 0;

    const lowConcreteScore = Stats.normalizeInverse(concreteDensity, 0.012, 0.07);
    const lowSpecificSentenceScore = Stats.normalizeInverse(
      sentenceSpecificityRatio,
      0.22,
      0.8
    );
    const abstractDominance = Stats.normalizeRange(abstractDensity, 0.03, 0.12);

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (lowConcreteScore > 0.58) {
      reasons.push("Concrete evidence is sparse compared with the overall length.");
      triggers.push({
        category: "specificity_deficit",
        label: "Low concrete detail",
        evidence: `${concreteSignals.total} concrete markers appear across ${context.wordCount} words.`,
        count: concreteSignals.total,
        weight: 16,
        examples: []
      });
    }

    if (abstractDominance > 0.45) {
      reasons.push("Abstract nouns outweigh precise references and named details.");
      triggers.push({
        category: "specificity_deficit",
        label: "Abstract language",
        evidence: `${abstractCount} abstract terms appear across the text.`,
        count: abstractCount,
        weight: 12,
        examples: []
      });
    }

    context.sentenceRecords.forEach((record) => {
      const sentenceConcrete = countConcreteSignals(record.sentence).total;
      const sentenceAbstract = countSetHits(record.tokens, Patterns.abstractTerms);
      if (record.wordCount >= 10 && sentenceConcrete === 0 && sentenceAbstract >= 2) {
        flags.push({
          sentenceIndex: record.index,
          reason: "Broad claim with little concrete detail.",
          weight: 10
        });
      }
    });

    const rawScore = Stats.clamp(
      lowConcreteScore * 44 +
        lowSpecificSentenceScore * 28 +
        abstractDominance * 28,
      0,
      100
    );

    return createCategoryResult("specificity_deficit", rawScore, reasons, triggers, flags);
  }

  function analyzeBurstiness(context) {
    const localBurstiness = calculateRollingBurstiness(context.sentenceLengths);
    const shapeMonotony = calculateShapeMonotony(context.sentenceLengths);
    const punctuationVariety = calculatePunctuationVariety(context.sentenceRecords);

    const burstinessScore = Stats.normalizeInverse(localBurstiness, 0.14, 0.58);
    const monotonyScore = Stats.normalizeRange(shapeMonotony, 0.45, 0.85);
    const punctuationScore = Stats.normalizeInverse(punctuationVariety, 0.15, 0.7);

    const reasons = [];
    const triggers = [];
    const flags = [];

    if (burstinessScore > 0.55) {
      reasons.push("Sentence rhythm has low burstiness and stays smoother than typical human drafts.");
      triggers.push({
        category: "burstiness",
        label: "Low rhythm variance",
        evidence: `Rolling sentence-length variance is low (${localBurstiness.toFixed(2)}).`,
        count: context.sentenceCount,
        weight: 14,
        examples: []
      });
    }

    if (monotonyScore > 0.5) {
      reasons.push("Most sentences fall into the same rough size bucket.");
    }

    if (burstinessScore > 0.55 || monotonyScore > 0.55) {
      const run = findLongestMonotonyRun(context.sentenceLengths);
      if (run.length >= 4) {
        for (let index = run.start; index < run.start + run.length; index += 1) {
          flags.push({
            sentenceIndex: index,
            reason: "Falls inside a low-variance rhythm run.",
            weight: 8
          });
        }
      }
    }

    const rawScore = Stats.clamp(
      burstinessScore * 54 + monotonyScore * 30 + punctuationScore * 16,
      0,
      100
    );

    return createCategoryResult("burstiness", rawScore, reasons, triggers, flags);
  }

  function createCategoryResult(category, score, reasons, triggers, flags) {
    return {
      category,
      score: Stats.round(score),
      reasons,
      triggers,
      flags
    };
  }

  function countMeaningfulOpeners(sentenceRecords) {
    const map = new Map();

    sentenceRecords.forEach((record) => {
      const value = normalizeOpener(record.opener || record.shortOpener);
      if (!value) {
        return;
      }

      if (!map.has(value)) {
        map.set(value, {
          value,
          count: 0,
          indexes: []
        });
      }

      const entry = map.get(value);
      entry.count += 1;
      entry.indexes.push(record.index);
    });

    return Array.from(map.values()).sort((left, right) => right.count - left.count);
  }

  function normalizeOpener(value) {
    const tokens = Text.tokenize(value);
    if (tokens.length < 2) {
      return "";
    }

    const nonStopwords = tokens.filter((token) => !Patterns.stopwords.includes(token));
    if (!nonStopwords.length) {
      return "";
    }

    const joined = tokens.slice(0, 3).join(" ");
    return joined.length >= 7 ? joined : "";
  }

  function findRepeatedNgrams(tokens, stopwords, size) {
    const map = new Map();

    for (let index = 0; index <= tokens.length - size; index += 1) {
      const gramTokens = tokens.slice(index, index + size);
      const nonStopwordCount = gramTokens.filter((token) => !stopwords.includes(token)).length;
      if (nonStopwordCount < 2) {
        continue;
      }

      const value = gramTokens.join(" ");
      if (!map.has(value)) {
        map.set(value, {
          value,
          count: 0
        });
      }
      map.get(value).count += 1;
    }

    return Array.from(map.values()).sort((left, right) => right.count - left.count);
  }

  function collectTransitionStarts(sentenceRecords) {
    const map = new Map();

    sentenceRecords.forEach((record) => {
      const matched = Patterns.transitionPhrases.find((phrase) =>
        record.lowerSentence.startsWith(phrase)
      );
      if (!matched) {
        return;
      }

      if (!map.has(matched)) {
        map.set(matched, {
          value: matched,
          count: 0,
          indexes: []
        });
      }

      const entry = map.get(matched);
      entry.count += 1;
      entry.indexes.push(record.index);
    });

    return Array.from(map.values())
      .filter((entry) => entry.count >= 2)
      .sort((left, right) => right.count - left.count);
  }

  function averageAdjacentDifference(values) {
    if (values.length <= 1) {
      return 0;
    }

    let sum = 0;
    for (let index = 1; index < values.length; index += 1) {
      sum += Math.abs(values[index] - values[index - 1]);
    }

    return sum / (values.length - 1);
  }

  function findSimilarLengthRuns(lengths) {
    const runs = [];
    let start = 0;

    for (let index = 1; index <= lengths.length; index += 1) {
      const previous = lengths[index - 1];
      const current = lengths[index];
      const closeEnough =
        typeof current === "number" &&
        Math.abs(current - previous) <= Math.max(3, Math.round(previous * 0.16));

      if (closeEnough) {
        continue;
      }

      const runLength = index - start;
      if (runLength >= 4) {
        runs.push({
          start,
          length: runLength
        });
      }
      start = index;
    }

    return runs;
  }

  function findPhraseHits(text, phrases) {
    return phrases
      .map((phrase) => ({
        value: phrase,
        count: countOccurrences(text, phrase)
      }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count);
  }

  function countOccurrences(text, phrase) {
    let count = 0;
    let index = 0;

    while (index >= 0) {
      index = text.indexOf(phrase, index);
      if (index < 0) {
        break;
      }
      count += 1;
      index += phrase.length;
    }

    return count;
  }

  function countSetHits(tokens, terms) {
    const termSet = new Set(terms);
    return tokens.reduce((sum, token) => sum + (termSet.has(token) ? 1 : 0), 0);
  }

  function countTermHits(text, terms) {
    return terms.reduce((sum, term) => sum + countOccurrences(text, term), 0);
  }

  function collectSentencePhraseHits(records, phrases) {
    const hits = [];

    records.forEach((record) => {
      phrases.forEach((phrase) => {
        if (record.lowerSentence.includes(phrase)) {
          hits.push({
            sentenceIndex: record.index,
            phrase
          });
        }
      });
    });

    return hits;
  }

  function countConcreteSignals(text) {
    const sentenceList = Text.splitSentences(text);
    const total =
      matchCount(text, /\b\d+(?:\.\d+)?(?:%|x|k|m|b)?\b/g) +
      matchCount(text, /\b(?:19|20)\d{2}\b/g) +
      matchCount(text, /[$\u20AC\u00A3]\s?\d+(?:,\d{3})*(?:\.\d+)?/g) +
      matchCount(text, /"[^"]{3,}"/g) +
      countNamedEntityHints(text);

    const sentencesWithConcrete = sentenceList.filter((sentence) => {
      return (
        matchCount(sentence, /\b\d+(?:\.\d+)?(?:%|x|k|m|b)?\b/g) > 0 ||
        matchCount(sentence, /\b(?:19|20)\d{2}\b/g) > 0 ||
        countNamedEntityHints(sentence) > 0
      );
    }).length;

    return {
      total,
      sentencesWithConcrete
    };
  }

  function countNamedEntityHints(text) {
    const matches = text.match(/\b(?:[A-Z][a-z]{2,}|[A-Z]{2,})\b/g) || [];
    return matches.filter((word) => !COMMON_CAPITALIZED_WORDS.has(word.toLowerCase())).length;
  }

  function matchCount(text, regex) {
    return (text.match(regex) || []).length;
  }

  function calculateRollingBurstiness(lengths) {
    if (lengths.length < 4) {
      return 1;
    }

    const windowVariances = [];
    for (let index = 0; index <= lengths.length - 4; index += 1) {
      const slice = lengths.slice(index, index + 4);
      const mean = Stats.mean(slice);
      const averageDeviation =
        slice.reduce((sum, value) => sum + Math.abs(value - mean), 0) / slice.length;
      windowVariances.push(averageDeviation / Math.max(mean, 1));
    }

    return Stats.mean(windowVariances);
  }

  function calculateShapeMonotony(lengths) {
    if (!lengths.length) {
      return 0;
    }

    const buckets = {
      short: 0,
      medium: 0,
      long: 0
    };

    lengths.forEach((length) => {
      if (length <= 12) {
        buckets.short += 1;
        return;
      }
      if (length <= 24) {
        buckets.medium += 1;
        return;
      }
      buckets.long += 1;
    });

    const dominant = Math.max(buckets.short, buckets.medium, buckets.long);
    return dominant / lengths.length;
  }

  function calculatePunctuationVariety(sentenceRecords) {
    if (!sentenceRecords.length) {
      return 0;
    }

    const counts = new Map();
    sentenceRecords.forEach((record) => {
      const key = record.punctuationEnd || ".";
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return counts.size / sentenceRecords.length;
  }

  function findLongestMonotonyRun(lengths) {
    let bestRun = { start: 0, length: 0 };
    let currentStart = 0;

    for (let index = 1; index <= lengths.length; index += 1) {
      const previous = lengths[index - 1];
      const current = lengths[index];
      const closeEnough =
        typeof current === "number" &&
        Math.abs(current - previous) <= Math.max(3, Math.round(previous * 0.18));

      if (closeEnough) {
        continue;
      }

      const length = index - currentStart;
      if (length > bestRun.length) {
        bestRun = {
          start: currentStart,
          length
        };
      }
      currentStart = index;
    }

    return bestRun;
  }
})(globalThis);

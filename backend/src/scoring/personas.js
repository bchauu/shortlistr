function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function clampScore0to5(n) {
  return clampInt(n, 0, 5);
}

function clampScore0to100(n) {
  return clampInt(n, 0, 100);
}

function safeStr(s) {
  return typeof s === "string" ? s : String(s || "");
}

function pickEvidence(signal) {
  const ev = signal && typeof signal === "object" && Array.isArray(signal.evidence) ? signal.evidence : [];
  const first = ev.map((x) => safeStr(x)).map((x) => x.trim()).filter(Boolean)[0] || "";
  if (!first) return "";
  return first.length > 140 ? first.slice(0, 140) + "…" : first;
}

function weightedScoreFromSubscores(subscores, weights) {
  const s = subscores && typeof subscores === "object" ? subscores : {};
  const roleIntent = clampScore0to5(s.role_intent_match);
  const responsibilities = clampScore0to5(s.responsibilities_match);
  const environment = clampScore0to5(s.environment_match);
  const preference = clampScore0to5(s.preference_match);
  const seniority = clampScore0to5(s.seniority_match);

  const w = weights || {};
  const sum =
    roleIntent * (Number(w.role_intent_match) || 0) +
    responsibilities * (Number(w.responsibilities_match) || 0) +
    environment * (Number(w.environment_match) || 0) +
    preference * (Number(w.preference_match) || 0) +
    seniority * (Number(w.seniority_match) || 0);

  const normalized = (sum / 5) * 100;
  return clampScore0to100(normalized);
}

function confidenceFactor(subscores) {
  const s = subscores && typeof subscores === "object" ? subscores : {};
  const conf = clampScore0to5(s.confidence);
  return Math.max(0, Math.min(1, conf / 5));
}

function makeNotes({ persona, delta, jobExtract, candidateExtract }) {
  const jobSignals = jobExtract && typeof jobExtract === "object" ? jobExtract.signals || {} : {};
  const candSignals = candidateExtract && typeof candidateExtract === "object" ? candidateExtract.signals || {} : {};
  const roleArchetype = safeStr(jobExtract?.role_archetype || "").toLowerCase();

  const notes = [];

  if (persona === "scrappy_founder") {
    const builderEv = pickEvidence(candSignals.full_stack_engineering) || pickEvidence(candSignals.llm_orchestration);
    const agencyEv = pickEvidence(candSignals.ambiguity_high_agency);
    const changeEv = pickEvidence(jobSignals.change_management_adoption);
    const customerEv = pickEvidence(jobSignals.customer_facing_delivery);

    if (delta >= 2) {
      notes.push(builderEv ? `Over-indexes on owner-operator building (${builderEv}).` : "Over-indexes on owner-operator building and shipping.");
      if (agencyEv) notes.push(`High-agency / ambiguity comfort is a plus (${agencyEv}).`);
      else if (customerEv) notes.push(`Direct customer delivery is a plus (${customerEv}).`);
    } else if (delta <= -2) {
      if (roleArchetype.includes("consult") || roleArchetype.includes("pre_sales") || changeEv) {
        notes.push(changeEv ? `Feels more change-management / enterprise delivery (${changeEv}).` : "Feels more change-management / enterprise delivery than builder.");
      } else {
        notes.push("Less excited if day-to-day is mostly delivery vs. building.");
      }
      if (customerEv) notes.push(`Customer-facing delivery still matters (${customerEv}).`);
    } else {
      notes.push("Similar to neutral evaluation for a founder lens.");
    }
  }

  if (persona === "enterprise_delivery") {
    const integEv = pickEvidence(jobSignals.integrations_data_pipelines);
    const entEv = pickEvidence(jobSignals.enterprise_systems);
    const customerEv = pickEvidence(jobSignals.customer_facing_delivery);
    const candEntEv = pickEvidence(candSignals.enterprise_systems) || pickEvidence(candSignals.integrations_data_pipelines);

    if (delta >= 2) {
      notes.push(integEv || entEv ? `Likes enterprise/integration delivery emphasis (${integEv || entEv}).` : "Likes enterprise/integration delivery emphasis.");
      if (customerEv) notes.push(`Customer-facing execution is a plus (${customerEv}).`);
    } else if (delta <= -2) {
      notes.push(!candEntEv ? "Enterprise integrations/systems experience is unclear from your profile." : `Enterprise systems/integrations evidence is limited (${candEntEv}).`);
      if (integEv || entEv) notes.push(`Role expects enterprise delivery (${integEv || entEv}).`);
    } else {
      notes.push("Similar to neutral evaluation for an enterprise delivery lens.");
    }
  }

  return notes.slice(0, 3);
}

export function computePersonaLenses({ baseScore, subscores, jobExtract, candidateExtract, maxScore = 100 }) {
  const neutralWeights = {
    role_intent_match: 0.15,
    responsibilities_match: 0.3,
    environment_match: 0.25,
    preference_match: 0.15,
    seniority_match: 0.15
  };

  const personas = [
    {
      id: "scrappy_founder",
      label: "Scrappy founder",
      weights: {
        role_intent_match: 0.25,
        responsibilities_match: 0.25,
        environment_match: 0.3,
        preference_match: 0.15,
        seniority_match: 0.05
      }
    },
    {
      id: "enterprise_delivery",
      label: "Enterprise delivery",
      weights: {
        role_intent_match: 0.1,
        responsibilities_match: 0.3,
        environment_match: 0.35,
        preference_match: 0.1,
        seniority_match: 0.15
      }
    }
  ];

  const base = clampScore0to100(baseScore);
  const maxAllowed = clampScore0to100(maxScore);
  if (!subscores || typeof subscores !== "object") {
    const baseClamped = Math.min(base, maxAllowed);
    return personas.map((p) => ({ persona: p.id, label: p.label, adjustedScore: baseClamped, delta: 0, notes: [] }));
  }

  const neutral = weightedScoreFromSubscores(subscores, neutralWeights);
  const conf = confidenceFactor(subscores);

  return personas.map((p) => {
    const personaScore = weightedScoreFromSubscores(subscores, p.weights);
    const deltaRaw = personaScore - neutral;
    const deltaBounded = Math.max(-10, Math.min(10, deltaRaw));
    const delta = clampInt(deltaBounded * conf, -10, 10);

    const adjustedScore = Math.max(0, Math.min(maxAllowed, base + delta));

    return {
      persona: p.id,
      label: p.label,
      adjustedScore: clampScore0to100(adjustedScore),
      delta,
      notes: makeNotes({ persona: p.id, delta, jobExtract, candidateExtract })
    };
  });
}

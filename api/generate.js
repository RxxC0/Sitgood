// Fonction serveur Vercel : la clé Anthropic reste ici, jamais dans le navigateur.
// Variables d'environnement : ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
const CONCERNS = ["Pipi dans la maison", "Aboiements", "Il mord", "Tire en laisse", "Ne revient pas", "Reste seul"];
const GOALS = ["Un chien propre", "Un chien calme", "Un chien qui obéit", "Un chien qui reste seul"];
const UNITS = { semaines: 1, mois: 4.35, "années": 52.18 };
const ICONS = ["main", "oeil", "repeter", "coeur", "sourire", "etoile", "temps", "valider"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const u = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: process.env.SUPABASE_ANON_KEY },
    });
    if (!token || !u.ok) return res.status(401).json({ error: "auth" });

    const b = req.body || {};
    const name = String(b.name || "").replace(/[^\p{L}\p{N} '’-]/gu, "").slice(0, 20).trim();
    const age = parseInt(b.age, 10);
    const weeks = age * (UNITS[b.unit] || 0);
    const minutes = [5, 10, 15].includes(b.minutes) ? b.minutes : 0;
    const breed = String(b.breed || "").replace(/[^\p{L}\p{N} /'’-]/gu, "").slice(0, 40);
    if (!name || !age || weeks < 6 || weeks > 1043 || !breed || !minutes ||
        !["chiot", "adulte"].includes(b.kind) || !CONCERNS.includes(b.concern) || !GOALS.includes(b.goal))
      return res.status(422).json({ error: "bad" });

    const prompt = `Tu es éducateur canin, méthode positive uniquement. Chien : ${b.kind === "chiot" ? "chiot" : "chien adulte"}, prénom ${name}, âge ${age} ${b.unit}, race ${breed}, souci principal : ${b.concern}, objectif : ${b.goal}, a déjà essayé d'autres méthodes : ${b.tried ? "oui" : "non"}, temps disponible par jour : ${minutes} minutes.
Si l'âge ou la race sont incohérents pour un chien, réponds exactement {"erreur":true}.
Sinon réponds UNIQUEMENT par un JSON valide, sans texte autour :
{"erreur":false,"score":entier entre 10 et 85 (niveau d'éducation actuel, selon l'âge et le souci),"verdict":"une phrase française drôle qui pique gentiment le chien mais reste bienveillante, 80 caractères maximum","notes":{"proprete":entier 0-100,"obeissance":entier 0-100,"calme":entier 0-100},"exercices":[2 ou 3 objets {"titre":"court","duree_min":entier,"resume":"1 phrase sur le but de l'exercice","etapes":[exactement 3 objets {"icone":"un mot parmi ${ICONS.join(", ")}","texte":"1 phrase courte, douce, sans aucune punition, adaptée à l'âge et au stade de vie"}]}]}
La somme des duree_min vaut exactement ${minutes}. Les exercices traitent le souci principal. Français impeccable, tutoiement, ton chaleureux.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return res.status(502).json({ error: "ia" });
    const text = ((await r.json()).content || []).map((c) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "format" });
    const j = JSON.parse(m[0]);
    if (j.erreur) return res.status(422).json({ error: "bad" });

    const n = (x) => Math.max(0, Math.min(100, Math.round(Number(x))));
    const exercises = j.exercices.slice(0, 3).map((e) => ({
      titre: String(e.titre), duree: Math.max(1, Math.round(Number(e.duree_min))), resume: String(e.resume || ""),
      etapes: e.etapes.slice(0, 3).map((s, k) => ({ ic: ICONS.includes(s.icone) ? s.icone : ICONS[k], t: String(s.texte) })),
    }));
    if (exercises.length < 2 || exercises.some((e) => e.etapes.length < 3 || e.etapes.some((s) => !s.t)))
      return res.status(502).json({ error: "format" });
    const rest = exercises.slice(0, -1).reduce((a, e) => a + e.duree, 0);
    exercises[exercises.length - 1].duree = Math.max(1, minutes - rest);
    const out = { score: n(j.score), verdict: String(j.verdict), notes: { proprete: n(j.notes.proprete), obeissance: n(j.notes.obeissance), calme: n(j.notes.calme) }, exercises };
    if (!out.verdict) return res.status(502).json({ error: "format" });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "server" });
  }
};

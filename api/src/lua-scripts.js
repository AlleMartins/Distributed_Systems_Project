// Script Lua per le operazioni Redis di tipo check-then-act.
// Stanno tutti qui perché condividono la stessa motivazione, ed è la
// motivazione a dover restare leggibile: in un sistema distribuito una
// sequenza GET+azione non è atomica, e nella finestra fra i due comandi lo
// stato può cambiare sotto di noi. Redis esegue invece un EVAL come
// un'unica operazione indivisibile (è single-threaded sull'esecuzione dei
// comandi, quindi nessun altro comando si intromette a metà script).
//
// Regola per chi estende il progetto: qualunque nuova operazione Redis che
// legge un valore e agisce in base a quello che ha letto va scritta qui
// come script, non come due comandi separati lato Node.

// Rinnovo ATOMICO di un lock (usato sia per la leadership sia per il claim
// del proprietario). GET+PEXPIRE separati non sono atomici: nella finestra
// tra i due comandi il lock potrebbe scadere ed essere acquisito da un
// altro pod, e la PEXPIRE successiva estenderebbe il TTL della SUA chiave,
// non della nostra (split-brain: due pod convinti entrambi di essere leader).
const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

// Rilascio ATOMICO del lock sul claim di un incidente.
// Stesso principio del rinnovo: un DEL incondizionato cancellerebbe
// qualsiasi lock trovi sulla chiave, anche se nel frattempo è scaduto
// e un altro analista lo ha già preso (gli cancelleremmo il lock per
// errore). Rilasciamo SOLO se il valore corrisponde ancora a chi sta
// chiudendo l'incidente.
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// Lettura in blocco dei lock attivi (proprietario + TTL residuo) da
// allegare allo snapshot REST.
// Perché non una MGET seguita da N PTTL: proprietario e TTL verrebbero
// letti in istanti diversi, e un lock scaduto nel frattempo darebbe una
// coppia incoerente (owner valorizzato, TTL -2). Dentro EVAL le due letture
// avvengono nello stesso istante logico.
// Restituisce una lista piatta [chiave, owner, ttl, chiave, owner, ttl, ...]
// contenente solo le chiavi effettivamente presenti.
const READ_LOCKS_SCRIPT = `
  local out = {}
  for i, key in ipairs(KEYS) do
    local owner = redis.call("get", key)
    if owner then
      out[#out + 1] = key
      out[#out + 1] = owner
      out[#out + 1] = redis.call("pttl", key)
    end
  end
  return out
`;

module.exports = { RENEW_LOCK_SCRIPT, RELEASE_LOCK_SCRIPT, READ_LOCKS_SCRIPT };

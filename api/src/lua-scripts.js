const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

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

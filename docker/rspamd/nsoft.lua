-- Copyright © 2026 M Suthakaran, trading as NSoft Academy.
-- Licensed under the Apache License, Version 2.0.
rspamd_config:register_symbol({
  name = 'NSOFT_AUTHENTICATED_FROM',
  type = 'postfilter',
  callback = function(task)
    if not task:get_user() then return end
    local header = task:get_from('mime')
    local envelope = task:get_from('smtp')
    if not header or #header ~= 1 or not envelope or #envelope ~= 1
       or not header[1].addr or not envelope[1].addr
       or string.lower(header[1].addr) ~= string.lower(envelope[1].addr) then
      task:set_pre_result('reject', 'From header must match the authenticated envelope sender', 'nsoft')
    end
  end
})

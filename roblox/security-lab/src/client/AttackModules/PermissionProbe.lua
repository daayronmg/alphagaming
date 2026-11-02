--!strict
-- Module 5 — Permissions / Privilege
-- Calls privileged remotes as an ordinary (non-admin) player. For RemoteFunctions
-- a non-nil response is suspicious and flagged for review; for RemoteEvents the
-- result is INCONCLUSIVE unless a probe confirms the privileged action happened.
--
-- Replace the list with YOUR privileged remote names.

local M = { name = "Permissions / Privilege", order = 50 }

local PRIVILEGED = { "AdminKick", "GiveItem", "SetStat", "Shutdown", "TeleportPlayer" }

function M.run(ctx)
	if not ctx.remotes then
		ctx.report({
			module = M.name,
			severity = "info",
			title = "Remotes folder not found",
			detail = "Set Config.RemotesParent to the path of your remotes.",
		})
		return
	end

	local tested = 0
	for _, name in ipairs(PRIVILEGED) do
		local rem = ctx.remotes:FindFirstChild(name)
		if rem then
			tested += 1
			if rem:IsA("RemoteFunction") then
				local ok, res = ctx.invokeFunction(name)
				ctx.report({
					module = M.name,
					severity = ok and "medium" or "low",
					title = name .. (ok and " responded to non-admin" or " rejected non-admin"),
					detail = ok
							and ("Returned " .. tostring(res) .. " to an unprivileged caller — verify authorization server-side.")
						or "Threw/blocked for a non-admin (good).",
				})
			else
				ctx.fireEvent(name)
				ctx.report({
					module = M.name,
					severity = "info",
					title = name .. " fired as non-admin",
					detail = "INCONCLUSIVE — confirm with a probe whether the privileged action actually took effect.",
				})
			end
		end
	end

	if tested == 0 then
		ctx.report({
			module = M.name,
			severity = "info",
			title = "No privileged remotes matched",
			detail = "Edit PRIVILEGED in PermissionProbe.lua with your admin remote names.",
		})
	end
end

return M

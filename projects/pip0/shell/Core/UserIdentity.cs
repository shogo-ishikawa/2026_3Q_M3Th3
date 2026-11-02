using System;
using System.Security.Principal;

namespace Pip0Shell.Core;

/// <summary>サインインしているユーザーの SID（S-1-5-21-…）。同期ルートの ID と、二重起動の防止に使う</summary>
internal static class UserIdentity
{
    public static string GetCurrentSid()
    {
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        SecurityIdentifier? sid = identity.User;
        if (sid is null)
        {
            throw new InvalidOperationException("ユーザーの SID を取得できません。");
        }
        return sid.Value;
    }
}

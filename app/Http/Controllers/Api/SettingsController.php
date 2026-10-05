<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Models\UserAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

class SettingsController extends Controller
{
    /**
     * Return all persisted settings as a flat key/value map.
     */
    public function index(Request $request)
    {
        $all = Setting::allAsArray();

        return response()->json([
            'general' => $all['general'] ?? null,
            'notifications' => $all['notifications'] ?? null,
            'security' => $all['security'] ?? null,
            'roles_permissions' => $all['roles_permissions'] ?? null,
            'logo_url' => $all['logo_url'] ?? null,
        ]);
    }

    /**
     * Persist settings. Each top-level key is stored under that setting name.
     */
    public function update(Request $request)
    {
        $validated = $request->validate([
            'general' => ['nullable', 'array'],
            'general.system_name' => ['nullable', 'string', 'max:255'],
            'general.institution' => ['nullable', 'string', 'max:255'],
            'general.contact_email' => ['nullable', 'email', 'max:255'],
            'general.timezone' => ['nullable', 'string', 'max:255'],
            'notifications' => ['nullable', 'array'],
            'security' => ['nullable', 'array'],
            'security.two_factor' => ['nullable', 'boolean'],
            'security.session_timeout' => ['nullable', Rule::in(['15', '30', '60', 'never'])],
            'roles_permissions' => ['nullable', 'array'],
            'roles_permissions.*.role' => ['required_with:roles_permissions', 'string', 'max:255'],
        ]);

        $groups = ['general', 'notifications', 'security', 'roles_permissions'];

        foreach ($groups as $group) {
            if (array_key_exists($group, $validated)) {
                Setting::set($group, $validated[$group]);
            }
        }

        return response()->json($this->index($request));
    }

    /**
     * Change the authenticated account's password.
     */
    public function updatePassword(Request $request)
    {
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8', 'max:255', 'confirmed'],
        ]);

        $account = $request->user();

        if (! $account instanceof UserAccount || ! Hash::check($validated['current_password'], $account->password)) {
            return response()->json(['message' => 'The current password is incorrect.'], 422);
        }

        $account->update(['password' => Hash::make($validated['new_password'])]);

        // Any other device holding a token for this account must be signed out.
        $currentToken = $account->currentAccessToken();

        if ($currentToken instanceof PersonalAccessToken) {
            $account->tokens()->whereKeyNot($currentToken->getKey())->delete();
        }

        return response()->json(['message' => 'Password updated successfully.']);
    }

    /**
     * Upload a new system logo and store its public URL.
     */
    public function uploadLogo(Request $request)
    {
        $validated = $request->validate([
            'logo' => ['required', 'image', 'mimes:png,jpg,jpeg,svg,webp', 'max:2048'],
        ]);

        $path = $request->file('logo')->store('logos', 'public');

        $url = Storage::disk('public')->url($path);

        Setting::set('logo_url', $url);

        return response()->json(['logo_url' => $url]);
    }
}
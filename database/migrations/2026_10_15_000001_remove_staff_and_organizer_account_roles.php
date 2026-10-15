<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Preserve accounts and their history while moving their active role.
        DB::table('user_accounts')->whereIn('role', ['Staff', 'Organizer'])->update(['role' => 'Student']);
        DB::table('registrations')->whereIn('role', ['Staff', 'Organizer'])->update(['role' => 'Student']);

        // Keep existing audience targeting meaningful after the conversion.
        DB::table('events')->whereIn('target_role', ['Staff', 'Organizer'])->update(['target_role' => 'Student']);
        DB::table('announcements')->whereIn('audience', ['Staff', 'Organizers'])->update(['audience' => 'Students']);

        // Discard obsolete elevated permission rows instead of copying those
        // permissions to every student. Preserve valid custom role settings.
        $stored = DB::table('settings')->where('key', 'roles_permissions')->value('value');
        $rows = is_string($stored) ? json_decode($stored, true) : null;
        $byRole = collect(is_array($rows) ? $rows : [])
            ->filter(fn ($row) => is_array($row) && in_array($row['role'] ?? null, ['Admin', 'Student', 'Scanner'], true))
            ->keyBy('role');

        $defaults = [
            'Admin' => ['manage_users' => true, 'manage_events' => true, 'approve_events' => true, 'view_reports' => true, 'manage_settings' => true],
            'Student' => ['manage_users' => false, 'manage_events' => false, 'approve_events' => false, 'view_reports' => false, 'manage_settings' => false],
            'Scanner' => ['manage_users' => false, 'manage_events' => false, 'approve_events' => false, 'view_reports' => false, 'manage_settings' => false],
        ];

        $permissions = collect($defaults)->map(function (array $capabilities, string $role) use ($byRole) {
            $existing = $byRole->get($role, []);

            return ['role' => $role] + array_merge($capabilities, array_intersect_key($existing, $capabilities));
        })->values()->all();

        DB::table('settings')->updateOrInsert(
            ['key' => 'roles_permissions'],
            ['value' => json_encode($permissions), 'updated_at' => now()],
        );
    }

    public function down(): void
    {
        // Intentionally irreversible: restoring retired account roles would
        // make roles the current application no longer recognizes active again.
    }
};

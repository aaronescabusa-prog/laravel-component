<?php

namespace App\Http\Middleware;

use App\Models\Setting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class EnsureRole
{
    /**
     * Default access matrix. Admins always have full access.
     * `write` may be expanded by the roles & permissions settings.
     */
    private const DEFAULT_MATRIX = [
        'announcements' => ['read' => ['Admin', 'Staff', 'Organizer', 'Student'], 'write' => ['Admin', 'Staff']],
        'events' => ['read' => ['Admin', 'Staff', 'Organizer', 'Student'], 'write' => ['Admin', 'Staff', 'Organizer']],
        'user-accounts' => ['read' => ['Admin', 'Staff', 'Organizer'], 'write' => ['Admin', 'Staff']],
        'registrations' => ['read' => ['Admin', 'Staff', 'Organizer'], 'write' => ['Admin', 'Staff', 'Organizer']],
        'certificates' => ['read' => ['Admin', 'Staff', 'Organizer', 'Student'], 'write' => ['Admin', 'Staff', 'Organizer']],
        'evaluations' => ['read' => ['Admin', 'Staff', 'Organizer', 'Student'], 'write' => ['Admin', 'Staff', 'Organizer', 'Student']],
        'activity-logs' => ['read' => ['Admin', 'Staff'], 'write' => ['Admin']],
        'settings' => ['read' => ['Admin', 'Staff'], 'write' => ['Admin']],
        'reports' => ['read' => ['Admin', 'Staff', 'Organizer'], 'write' => []],
    ];

    /**
     * Maps a settings capability to the resources it unlocks write access to.
     */
    private const CAPABILITY_RESOURCES = [
        'manage_users' => ['user-accounts'],
        'manage_events' => ['events', 'announcements', 'registrations', 'certificates', 'evaluations'],
        'approve_events' => ['events'],
        'view_reports' => ['reports'],
        'manage_settings' => ['settings'],
    ];

    public function handle(Request $request, Closure $next, string $resource): mixed
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($user->role === 'Admin') {
            return $next($request);
        }

        $matrix = $this->matrixFor($resource);
        $roles = $request->isMethodSafe()
            ? ($matrix['read'] ?? [])
            : ($matrix['write'] ?? []);

        if (in_array($user->role, $roles, true)) {
            return $next($request);
        }

        return response()->json(['message' => 'You do not have permission to perform this action.'], 403);
    }

    /**
     * Resolve the effective access list for a resource, merging the persisted
     * roles & permissions settings into the write list of the defaults.
     */
    private function matrixFor(string $resource): array
    {
        $matrix = self::DEFAULT_MATRIX[$resource] ?? ['read' => [], 'write' => []];

        $persisted = Setting::value('roles_permissions');

        if (! is_array($persisted)) {
            return $matrix;
        }

        foreach (self::CAPABILITY_RESOURCES as $capability => $resources) {
            if (! in_array($resource, $resources, true)) {
                continue;
            }

            $granted = ['Admin'];

            foreach ($persisted as $row) {
                if (! is_array($row) || empty($row['role'])) {
                    continue;
                }

                $grantedCapability = ! empty($row[$capability]) || ! empty($row[Str::camel($capability)]);

                if ($grantedCapability) {
                    $granted[] = $row['role'];
                }
            }

            $matrix['write'] = array_values(array_unique(array_merge($matrix['write'], $granted)));
        }

        return $matrix;
    }
}
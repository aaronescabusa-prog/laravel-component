<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\UserAccount;
use App\Support\AcademicStructure;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AnnouncementController extends Controller
{
    /**
     * Roles that manage announcements — the write side of the EnsureRole
     * matrix. Everyone else may only read what is addressed to them.
     */
    private const MANAGERS = ['Admin'];

    /**
     * The audience value each reader role is entitled to, alongside "All
     * Users".
     */
    private const AUDIENCE_FOR_ROLE = [
        'Student' => 'Students',
    ];
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Announcement::query();

        // Non-managers only see what is published and addressed to them. The
        // audience column is metadata every reader can see but only staff may
        // choose, so it has to be enforced here rather than left as a label.
        $this->restrictToReader($query, $request->user());

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('title', 'like', "%{$term}%")
                    ->orWhere('message', 'like', "%{$term}%")
                    ->orWhere('author', 'like', "%{$term}%");
            });
        }

        if ($request->filled('audience')) {
            $query->where('audience', $request->string('audience')->toString());
        }

        if ($request->filled('status')) {
            $query->where('status', $request->string('status')->toString());
        }

        return response()->json(
            $query->orderByDesc('publish_date')->orderByDesc('id')->paginate(
                $this->perPage($request)
            )
        );
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:50', Rule::unique('announcements', 'reference')->whereNull('deleted_at')],
            'title' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string'],
            'audience' => ['required', 'string', Rule::in(['All Users', 'Students'])],
            'target_role' => ['nullable', 'string', Rule::in(['All', 'Admin', 'Student'])],
            'target_department' => ['nullable', 'string', Rule::in(array_column(AcademicStructure::DEPARTMENTS, 'code'))],
            'target_course' => ['nullable', 'string', Rule::in(AcademicStructure::COURSES)],
            'target_year' => ['nullable', 'string', Rule::in(AcademicStructure::YEARS)],
            'target_block' => ['nullable', 'string', 'max:50'],
            'category' => ['required', 'string', Rule::in(['General', 'Event', 'Emergency', 'Maintenance'])],
            'status' => ['required', 'string', Rule::in(['Draft', 'Scheduled', 'Published'])],
            'publish_date' => ['nullable', 'date'],
            'author' => ['nullable', 'string', 'max:255'],
        ]);

        $announcement = Announcement::create($validated);

        return response()->json($announcement, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, Announcement $announcement)
    {
        // Match index(): a reader cannot reach by id what the listing hides.
        abort_unless($this->visibleToReader($request->user(), $announcement), 404);

        return response()->json($announcement);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Announcement $announcement)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('announcements', 'reference')->ignore($announcement->id)],
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'message' => ['sometimes', 'required', 'string'],
            'audience' => ['sometimes', 'required', 'string', Rule::in(['All Users', 'Students'])],
            'target_role' => ['sometimes', 'nullable', 'string', Rule::in(['All', 'Admin', 'Student'])],
            'target_department' => ['sometimes', 'nullable', 'string', Rule::in(array_column(AcademicStructure::DEPARTMENTS, 'code'))],
            'target_course' => ['sometimes', 'nullable', 'string', Rule::in(AcademicStructure::COURSES)],
            'target_year' => ['sometimes', 'nullable', 'string', Rule::in(AcademicStructure::YEARS)],
            'target_block' => ['sometimes', 'nullable', 'string', 'max:50'],
            'category' => ['sometimes', 'required', 'string', Rule::in(['General', 'Event', 'Emergency', 'Maintenance'])],
            'status' => ['sometimes', 'required', 'string', Rule::in(['Draft', 'Scheduled', 'Published'])],
            'publish_date' => ['nullable', 'date'],
            'author' => ['nullable', 'string', 'max:255'],
        ]);

        $announcement->update($validated);

        return response()->json($announcement->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Announcement $announcement)
    {
        $announcement->delete();

        return response()->noContent();
    }

    /**
     * Narrow a listing to the announcements a non-manager may see.
     *
     * Admins are left untouched: they author the notices and
     * must be able to see drafts and every audience.
     */
    private function restrictToReader($query, ?UserAccount $user): void
    {
        if ($this->isManager($user)) {
            return;
        }

        $query->where('status', 'Published')
            ->where(function ($publish): void {
                $publish->whereNull('publish_date')
                    ->orWhereDate('publish_date', '<=', now()->toDateString());
            })
            ->whereIn('audience', $this->audiencesFor($user))
            ->where(function ($target) use ($user): void {
                $target->whereNull('target_role')->orWhere('target_role', 'All')->orWhere('target_role', $user?->role);
            })
            ->where(function ($target) use ($user): void {
                $target->whereNull('target_department')->orWhere('target_department', $user?->department);
            })
            ->where(function ($target) use ($user): void {
                $target->whereNull('target_course')->orWhereRaw('LOWER(TRIM(target_course)) = ?', [mb_strtolower(trim((string) $user?->course))]);
            })
            ->where(function ($target) use ($user): void {
                $target->whereNull('target_year')->orWhereRaw('LOWER(TRIM(target_year)) = ?', [mb_strtolower(trim((string) $user?->year))]);
            })
            ->where(function ($target) use ($user): void {
                $target->whereNull('target_block')->orWhereRaw('LOWER(TRIM(target_block)) = ?', [mb_strtolower(trim((string) $user?->block_no))]);
            });
    }

    /** Whether a single announcement is visible to the given account. */
    private function visibleToReader(?UserAccount $user, Announcement $announcement): bool
    {
        if ($this->isManager($user)) {
            return true;
        }

        return $announcement->status === 'Published'
            && ($announcement->publish_date === null || $announcement->publish_date->toDateString() <= now()->toDateString())
            && in_array($announcement->audience, $this->audiencesFor($user), true)
            && (blank($announcement->target_role) || $announcement->target_role === 'All' || $announcement->target_role === $user?->role)
            && (blank($announcement->target_department) || $announcement->target_department === $user?->department)
            && (blank($announcement->target_course) || strcasecmp(trim($announcement->target_course), trim((string) $user?->course)) === 0)
            && (blank($announcement->target_year) || strcasecmp(trim($announcement->target_year), trim((string) $user?->year)) === 0)
            && (blank($announcement->target_block) || strcasecmp(trim($announcement->target_block), trim((string) $user?->block_no)) === 0);
    }

    private function isManager(?UserAccount $user): bool
    {
        return $user !== null && in_array($user->role, self::MANAGERS, true);
    }

    /**
     * The audiences an account may read: everyone sees "All Users", and a
     * reader also sees the notices addressed to their own role.
     *
     * @return list<string>
     */
    private function audiencesFor(?UserAccount $user): array
    {
        $audiences = ['All Users'];

        if ($user !== null && isset(self::AUDIENCE_FOR_ROLE[$user->role])) {
            $audiences[] = self::AUDIENCE_FOR_ROLE[$user->role];
        }

        return $audiences;
    }
    public function myAnnouncements(Request $request)
    {
        abort_unless($request->user()?->role === 'Student', 403);

        return $this->index($request);
    }
}

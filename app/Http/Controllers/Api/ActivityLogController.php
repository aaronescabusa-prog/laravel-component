<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class ActivityLogController extends Controller
{
    /**
     * Attempts made to find an unused reference before falling back to a random one.
     */
    private const REFERENCE_ATTEMPTS = 5;

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = ActivityLog::query();

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('user', 'like', "%{$term}%")
                    ->orWhere('action', 'like', "%{$term}%");
            });
        }

        if ($request->filled('category')) {
            $query->where('category', $request->string('category')->toString());
        }

        return response()->json($query->orderByDesc('id')->paginate(
            $this->perPage($request)
        ));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'reference' => ['nullable', 'string', 'max:50', Rule::unique('activity_logs', 'reference')],
            'timestamp' => ['nullable', 'string', 'max:30'],
            'user' => ['nullable', 'string', 'max:255'],
            'role' => ['nullable', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:255'],
            'action' => ['required', 'string', 'max:255'],
            'details' => ['nullable', 'string'],
        ]);

        $actor = $request->user();

        // Who did it and when is decided by the server, never by the request
        // body, so audit entries cannot be forged or back-dated.
        $validated['timestamp'] = now()->format('Y-m-d H:i:s');
        $validated['user'] = $actor?->name ?? 'System';
        $validated['role'] = $actor?->role ?? 'System';

        return response()->json($this->log($validated), 201);
    }

    /**
     * Persist an audit entry under a reference nobody else is using.
     *
     * References are sequential, so two requests logging at the same moment can
     * pick the same number. A losing insert is retried against a freshly read
     * maximum instead of bubbling up as a 500, which would silently drop audit
     * entries on the client.
     */
    private function log(array $attributes): ActivityLog
    {
        $reference = $attributes['reference'] ?? null;

        for ($attempt = 0; $attempt < self::REFERENCE_ATTEMPTS; $attempt++) {
            try {
                return ActivityLog::create([
                    ...$attributes,
                    'reference' => $reference ?? $this->nextReference(),
                ]);
            } catch (UniqueConstraintViolationException $e) {
                // A caller-supplied reference that collides is a client error;
                // only the generated sequence is worth retrying.
                if ($reference !== null) {
                    throw $e;
                }

                usleep(random_int(10_000, 50_000));
            }
        }

        return ActivityLog::create([
            ...$attributes,
            'reference' => $reference ?? 'LOG-'.Str::upper(Str::random(8)),
        ]);
    }

    /**
     * The next unused number in the LOG-##### sequence.
     *
     * The highest existing number is used rather than the newest row, because
     * seeded or imported entries are not guaranteed to be stored in numeric
     * order. Trashed rows count too: the unique index still holds their
     * references.
     */
    private function nextReference(): string
    {
        $highest = ActivityLog::withTrashed()->pluck('reference')
            ->reduce(fn (int $carry, $reference) => max($carry, (int) substr((string) $reference, 4)), 0);

        return 'LOG-'.str_pad((string) ($highest + 1), 5, '0', STR_PAD_LEFT);
    }

    /**
     * Display the specified resource.
     */
    public function show(ActivityLog $activityLog)
    {
        return response()->json($activityLog);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(ActivityLog $activityLog)
    {
        $activityLog->delete();

        return response()->noContent();
    }
}

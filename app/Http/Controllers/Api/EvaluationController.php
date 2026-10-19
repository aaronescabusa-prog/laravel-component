<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Evaluation;
use App\Models\Registration;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class EvaluationController extends Controller
{
    /** Return only evaluations owned through the student's registrations. */
    public function myEvaluations(Request $request)
    {
        $user = $request->user();
        abort_unless($user && $user->role === 'Student', 403, 'Only student accounts may view their evaluations.');

        $registrations = Registration::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($user->email))])
            ->with('eventRelation:id,reference,title')
            ->get()
            ->filter(fn (Registration $registration) => $registration->eventRelation !== null);

        $registrationsByEvaluationReference = $registrations->mapWithKeys(function (Registration $registration) use ($user) {
            $reference = 'EVL-'.strtoupper(substr(hash('sha256', $user->getKey().':'.$registration->getKey()), 0, 32));

            return [$reference => $registration];
        });

        $evaluations = Evaluation::query()
            ->whereIn('reference', $registrationsByEvaluationReference->keys())
            ->orderByDesc('date')
            ->orderByDesc('id')
            ->get()
            ->map(function (Evaluation $evaluation) use ($registrationsByEvaluationReference): array {
                $registration = $registrationsByEvaluationReference->get($evaluation->reference);

                return [
                    'reference' => $evaluation->reference,
                    'event_reference' => $registration->eventRelation->reference,
                    'event' => $evaluation->event,
                    'rating' => $evaluation->rating,
                    'comment' => $evaluation->comment,
                    'date' => $evaluation->date,
                ];
            })
            ->values();

        return response()->json(['data' => $evaluations]);
    }

    /** Accept feedback from a student for an event they registered for. */
    public function submitStudent(Request $request)
    {
        $user = $request->user();

        if (! $user || $user->role !== 'Student') {
            return response()->json(['message' => 'Only student accounts may submit event evaluations.'], 403);
        }

        $validated = $request->validate([
            'event_reference' => ['required', 'string', 'max:50'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:5000'],
        ]);

        $registration = Registration::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($user->email))])
            ->whereHas('eventRelation', fn ($query) => $query->where('reference', $validated['event_reference']))
            ->with('eventRelation')
            ->first();

        if (! $registration || ! $registration->eventRelation) {
            return response()->json(['message' => 'You must be registered for this event before submitting feedback.'], 422);
        }

        if (! $registration->attendances()->whereNotNull('time_in')->exists()) {
            return response()->json(['message' => 'You must check in to this event before submitting feedback.'], 422);
        }

        // One evaluation per student and registration. A stable reference lets
        // a student revise their response without creating duplicate feedback.
        $reference = 'EVL-'.strtoupper(substr(hash('sha256', $user->getKey().':'.$registration->getKey()), 0, 32));
        $evaluation = Evaluation::withTrashed()->where('reference', $reference)->first();

        $attributes = [
            'event' => $registration->eventRelation->title,
            'participant' => $user->name,
            'rating' => $validated['rating'],
            'comment' => $validated['comment'] ?? null,
            'date' => now()->format('Y-m-d'),
        ];

        if ($evaluation) {
            $evaluation->restore();
            $evaluation->fill($attributes)->save();
        } else {
            $evaluation = Evaluation::create(['reference' => $reference, ...$attributes]);
        }

        return response()->json($evaluation->fresh(), 201);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Evaluation::query();

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('participant', 'like', "%{$term}%")
                    ->orWhere('comment', 'like', "%{$term}%");
            });
        }

        if ($request->filled('event')) {
            $query->where('event', $request->string('event')->toString());
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
            'reference' => ['required', 'string', 'max:50', Rule::unique('evaluations', 'reference')->whereNull('deleted_at')],
            'event' => ['required', 'string', 'max:255'],
            'participant' => ['required', 'string', 'max:255'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string'],
            'date' => ['nullable', 'string', 'max:20'],
        ]);

        $evaluation = Evaluation::onlyTrashed()->where('reference', $validated['reference'])->first();

        if ($evaluation) {
            $evaluation->restore();
            $evaluation->fill($validated)->save();
        } else {
            $evaluation = Evaluation::create($validated);
        }

        return response()->json($evaluation, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Evaluation $evaluation)
    {
        return response()->json($evaluation);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Evaluation $evaluation)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('evaluations', 'reference')->ignore($evaluation->id)],
            'event' => ['sometimes', 'required', 'string', 'max:255'],
            'participant' => ['sometimes', 'required', 'string', 'max:255'],
            'rating' => ['sometimes', 'required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string'],
            'date' => ['nullable', 'string', 'max:20'],
        ]);

        $evaluation->update($validated);

        return response()->json($evaluation->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Evaluation $evaluation)
    {
        $evaluation->delete();

        return response()->noContent();
    }
}

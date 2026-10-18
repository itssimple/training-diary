// Starter content created on first launch. Generic exercises only: nothing here claims that a
// specific gym has a specific machine. Users edit the library to match their own gym.
// Stable ids let "Restore starter exercises" add missing entries without duplicating.

const E = (id, name, category, equipment, type, muscles, extra = {}) => ({
  id: `ex_${id}`, name, category, equipment, type, muscles, ...extra,
});

const RAW = [
  // Legs
  E('back_squat', 'Barbell back squat', 'Legs', 'Barbell', 'strength', ['Quads', 'Glutes', 'Adductors'], { alt: ['leg_press', 'goblet_squat', 'smith_squat'], rest: 150 }),
  E('smith_squat', 'Smith machine squat', 'Legs', 'Smith machine', 'strength', ['Quads', 'Glutes'], { alt: ['back_squat', 'leg_press'] }),
  E('goblet_squat', 'Goblet squat', 'Legs', 'Dumbbell', 'strength', ['Quads', 'Glutes'], { alt: ['back_squat', 'leg_press'] }),
  E('leg_press', 'Leg press', 'Legs', 'Machine', 'strength', ['Quads', 'Glutes'], { alt: ['back_squat', 'goblet_squat', 'smith_squat'] }),
  E('rdl', 'Romanian deadlift', 'Legs', 'Barbell', 'strength', ['Hamstrings', 'Glutes', 'Lower back'], { alt: ['db_rdl', 'leg_curl'], rest: 120 }),
  E('db_rdl', 'Dumbbell Romanian deadlift', 'Legs', 'Dumbbell', 'strength', ['Hamstrings', 'Glutes'], { alt: ['rdl', 'leg_curl'] }),
  E('deadlift', 'Deadlift', 'Back', 'Barbell', 'strength', ['Hamstrings', 'Glutes', 'Lower back', 'Traps'], { alt: ['rdl', 'trap_bar_deadlift'], rest: 180 }),
  E('trap_bar_deadlift', 'Trap bar deadlift', 'Legs', 'Other', 'strength', ['Quads', 'Glutes', 'Hamstrings'], { alt: ['deadlift'] }),
  E('leg_extension', 'Leg extension', 'Legs', 'Machine', 'strength', ['Quads'], { alt: ['goblet_squat'] }),
  E('leg_curl', 'Lying or seated leg curl', 'Legs', 'Machine', 'strength', ['Hamstrings'], { alt: ['db_rdl'] }),
  E('hip_thrust', 'Hip thrust', 'Legs', 'Barbell', 'strength', ['Glutes', 'Hamstrings'], { alt: ['glute_bridge'] }),
  E('glute_bridge', 'Glute bridge', 'Legs', 'Bodyweight', 'bodyweight', ['Glutes'], { alt: ['hip_thrust'] }),
  E('lunge', 'Walking lunge', 'Legs', 'Dumbbell', 'strength', ['Quads', 'Glutes'], { alt: ['split_squat'] }),
  E('split_squat', 'Bulgarian split squat', 'Legs', 'Dumbbell', 'strength', ['Quads', 'Glutes'], { alt: ['lunge'] }),
  E('calf_raise', 'Standing calf raise', 'Legs', 'Machine', 'strength', ['Calves'], { alt: [] }),
  // Chest
  E('bench_press', 'Barbell bench press', 'Chest', 'Barbell', 'strength', ['Chest', 'Triceps', 'Front delts'], { alt: ['db_bench_press', 'chest_press_machine', 'push_up'], rest: 150 }),
  E('db_bench_press', 'Dumbbell bench press', 'Chest', 'Dumbbell', 'strength', ['Chest', 'Triceps', 'Front delts'], { alt: ['bench_press', 'chest_press_machine'] }),
  E('incline_db_press', 'Incline dumbbell press', 'Chest', 'Dumbbell', 'strength', ['Chest', 'Front delts'], { alt: ['db_bench_press', 'chest_press_machine'] }),
  E('chest_press_machine', 'Chest press machine', 'Chest', 'Machine', 'strength', ['Chest', 'Triceps'], { alt: ['bench_press', 'db_bench_press', 'push_up'] }),
  E('chest_fly', 'Chest fly (machine or cable)', 'Chest', 'Machine', 'strength', ['Chest'], { alt: ['db_bench_press'] }),
  E('push_up', 'Push-up', 'Chest', 'Bodyweight', 'bodyweight', ['Chest', 'Triceps'], { alt: ['chest_press_machine'] }),
  E('dip', 'Dip', 'Chest', 'Bodyweight', 'bodyweight', ['Chest', 'Triceps'], { alt: ['triceps_pushdown'] }),
  // Back
  E('lat_pulldown', 'Lat pulldown', 'Back', 'Cable', 'strength', ['Lats', 'Biceps'], { alt: ['pull_up', 'assisted_pull_up'] }),
  E('pull_up', 'Pull-up', 'Back', 'Bodyweight', 'bodyweight', ['Lats', 'Biceps'], { alt: ['lat_pulldown', 'assisted_pull_up'] }),
  E('assisted_pull_up', 'Assisted pull-up (machine)', 'Back', 'Machine', 'strength', ['Lats', 'Biceps'], { alt: ['lat_pulldown', 'pull_up'], desc: 'Record the assistance weight. Lower assistance means harder.' }),
  E('seated_row', 'Seated cable row', 'Back', 'Cable', 'strength', ['Upper back', 'Lats'], { alt: ['db_row', 'barbell_row', 'machine_row'] }),
  E('machine_row', 'Row machine (chest supported)', 'Back', 'Machine', 'strength', ['Upper back', 'Lats'], { alt: ['seated_row', 'db_row'] }),
  E('db_row', 'One-arm dumbbell row', 'Back', 'Dumbbell', 'strength', ['Lats', 'Upper back'], { alt: ['seated_row', 'barbell_row'] }),
  E('barbell_row', 'Barbell row', 'Back', 'Barbell', 'strength', ['Upper back', 'Lats'], { alt: ['seated_row', 'db_row'] }),
  E('back_extension', 'Back extension', 'Back', 'Bench', 'bodyweight', ['Lower back', 'Glutes'], { alt: [] }),
  // Shoulders
  E('ohp', 'Overhead press', 'Shoulders', 'Barbell', 'strength', ['Front delts', 'Triceps'], { alt: ['db_shoulder_press', 'shoulder_press_machine'], rest: 120 }),
  E('db_shoulder_press', 'Dumbbell shoulder press', 'Shoulders', 'Dumbbell', 'strength', ['Front delts', 'Triceps'], { alt: ['ohp', 'shoulder_press_machine'] }),
  E('shoulder_press_machine', 'Shoulder press machine', 'Shoulders', 'Machine', 'strength', ['Front delts', 'Triceps'], { alt: ['db_shoulder_press', 'ohp'] }),
  E('lateral_raise', 'Lateral raise', 'Shoulders', 'Dumbbell', 'strength', ['Side delts'], { alt: ['cable_lateral_raise'], rest: 60 }),
  E('cable_lateral_raise', 'Cable lateral raise', 'Shoulders', 'Cable', 'strength', ['Side delts'], { alt: ['lateral_raise'], rest: 60 }),
  E('face_pull', 'Face pull', 'Shoulders', 'Cable', 'strength', ['Rear delts', 'Upper back'], { alt: ['reverse_fly'], rest: 60 }),
  E('reverse_fly', 'Reverse fly', 'Shoulders', 'Dumbbell', 'strength', ['Rear delts'], { alt: ['face_pull'], rest: 60 }),
  // Arms
  E('db_curl', 'Dumbbell biceps curl', 'Arms', 'Dumbbell', 'strength', ['Biceps'], { alt: ['cable_curl', 'barbell_curl'], rest: 60 }),
  E('barbell_curl', 'Barbell curl', 'Arms', 'Barbell', 'strength', ['Biceps'], { alt: ['db_curl', 'cable_curl'], rest: 60 }),
  E('cable_curl', 'Cable curl', 'Arms', 'Cable', 'strength', ['Biceps'], { alt: ['db_curl'], rest: 60 }),
  E('triceps_pushdown', 'Triceps pushdown', 'Arms', 'Cable', 'strength', ['Triceps'], { alt: ['overhead_triceps', 'dip'], rest: 60 }),
  E('overhead_triceps', 'Overhead triceps extension', 'Arms', 'Dumbbell', 'strength', ['Triceps'], { alt: ['triceps_pushdown'], rest: 60 }),
  // Core
  E('plank', 'Plank', 'Core', 'Bodyweight', 'timed', ['Abs'], { alt: ['dead_bug'], rest: 60 }),
  E('side_plank', 'Side plank', 'Core', 'Bodyweight', 'timed', ['Obliques'], { alt: ['plank'], rest: 45 }),
  E('dead_bug', 'Dead bug', 'Core', 'Bodyweight', 'bodyweight', ['Abs'], { alt: ['plank'], rest: 45 }),
  E('hanging_knee_raise', 'Hanging knee raise', 'Core', 'Bodyweight', 'bodyweight', ['Abs'], { alt: ['cable_crunch'], rest: 60 }),
  E('cable_crunch', 'Cable crunch', 'Core', 'Cable', 'strength', ['Abs'], { alt: ['hanging_knee_raise'], rest: 60 }),
  // Full body
  E('kb_swing', 'Kettlebell swing', 'Full body', 'Kettlebell', 'strength', ['Glutes', 'Hamstrings'], { alt: [] }),
  E('farmers_walk', "Farmer's walk", 'Full body', 'Dumbbell', 'timed', ['Forearms', 'Traps'], { alt: [], desc: 'Record time; put the weight in the notes or a set note.' }),
  // Gym cardio
  E('treadmill', 'Treadmill', 'Cardio', 'Cardio machine', 'cardio', ['Cardiovascular'], { alt: ['cross_trainer', 'stationary_bike', 'rowing_machine'], cardio: 'pace' }),
  E('stationary_bike', 'Stationary bike', 'Cardio', 'Cardio machine', 'cardio', ['Cardiovascular'], { alt: ['treadmill', 'cross_trainer'], cardio: 'speed' }),
  E('cross_trainer', 'Cross trainer', 'Cardio', 'Cardio machine', 'cardio', ['Cardiovascular'], { alt: ['treadmill', 'stationary_bike'], cardio: 'speed' }),
  E('rowing_machine', 'Rowing machine', 'Cardio', 'Cardio machine', 'cardio', ['Cardiovascular', 'Upper back'], { alt: ['stationary_bike'], cardio: 'pace' }),
  E('stair_climber', 'Stair climber', 'Cardio', 'Cardio machine', 'timed', ['Cardiovascular', 'Glutes'], { alt: ['treadmill'] }),
  // Outdoor / activities
  E('running', 'Running', 'Outdoor', 'Outdoor / none', 'cardio', ['Cardiovascular'], { alt: ['treadmill'], cardio: 'pace', activity: true }),
  E('walking', 'Walking', 'Outdoor', 'Outdoor / none', 'cardio', ['Cardiovascular'], { alt: [], cardio: 'pace', activity: true }),
  E('cycling', 'Cycling', 'Outdoor', 'Outdoor / none', 'cardio', ['Cardiovascular'], { alt: ['stationary_bike'], cardio: 'speed', activity: true }),
  E('hiking', 'Hiking', 'Outdoor', 'Outdoor / none', 'cardio', ['Cardiovascular'], { alt: ['walking'], cardio: 'pace', activity: true }),
  E('swimming', 'Swimming', 'Outdoor', 'Outdoor / none', 'cardio', ['Cardiovascular'], { alt: [], cardio: 'pace', activity: true }),
  E('other_activity', 'Other activity', 'Other', 'Other', 'other', [], { alt: [], activity: true }),
];

export function starterExercises(now = Date.now()) {
  return RAW.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.desc || '',
    category: r.category,
    equipment: r.equipment,
    type: r.type,
    muscles: r.muscles,
    instructions: '',
    notes: '',
    alternativeIds: (r.alt || []).map((a) => `ex_${a}`),
    defaultRestSec: r.rest ?? null,
    cardioDisplay: r.cardio || (r.type === 'cardio' ? 'pace' : null),
    isActivity: !!r.activity,
    archived: false,
    meta: [],
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  }));
}

const item = (id, exerciseId, exerciseName, sets, reps, extra = {}) => ({
  id, exerciseId: `ex_${exerciseId}`, exerciseName, groupId: null, sets, reps, weightKg: null, durationSec: null, distanceKm: null, restSec: null, notes: '', alternativeIds: [], ...extra,
});

export function starterProgram(now = Date.now()) {
  const program = {
    id: 'prg_starter',
    name: 'Starter: full body A/B',
    description: 'A simple example program to get started. Alternate A and B. Edit or delete it freely.',
    order: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const templates = [
    {
      id: 'tpl_starter_a', programId: program.id, name: 'Full body A', order: 0,
      notes: 'Warm up 5–10 min first. Weights are left blank on purpose: fill in what fits you.',
      groups: [{ id: 'grp_starter_a1', type: 'superset', restSec: 90 }],
      items: [
        item('it_a1', 'leg_press', 'Leg press', 3, 10, { restSec: 120 }),
        item('it_a2', 'chest_press_machine', 'Chest press machine', 3, 10),
        item('it_a3', 'lat_pulldown', 'Lat pulldown', 3, 10),
        item('it_a4', 'lateral_raise', 'Lateral raise', 3, 12, { groupId: 'grp_starter_a1' }),
        item('it_a5', 'face_pull', 'Face pull', 3, 15, { groupId: 'grp_starter_a1' }),
        item('it_a6', 'plank', 'Plank', 3, null, { durationSec: 40, restSec: 60 }),
      ],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'tpl_starter_b', programId: program.id, name: 'Full body B', order: 1,
      notes: 'Warm up 5–10 min first.',
      groups: [{ id: 'grp_starter_b1', type: 'superset', restSec: 75 }],
      items: [
        item('it_b1', 'rdl', 'Romanian deadlift', 3, 10, { restSec: 120 }),
        item('it_b2', 'db_shoulder_press', 'Dumbbell shoulder press', 3, 10),
        item('it_b3', 'seated_row', 'Seated cable row', 3, 10),
        item('it_b4', 'db_curl', 'Dumbbell biceps curl', 3, 12, { groupId: 'grp_starter_b1' }),
        item('it_b5', 'triceps_pushdown', 'Triceps pushdown', 3, 12, { groupId: 'grp_starter_b1' }),
        item('it_b6', 'treadmill', 'Treadmill', 1, null, { durationSec: 600, notes: 'Easy pace cool-down.' }),
      ],
      createdAt: now, updatedAt: now,
    },
  ];
  return { program, templates };
}

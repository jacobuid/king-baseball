// Display categories, not eligibility rules; leagues can use Other when needed.
export const DIVISIONS = [
  'T-Ball', 'Coach Pitch', 'Machine Pitch',
  ...Array.from({ length: 13 }, (_, index) => `${index + 6}U`),
  'Little League', 'Intermediate (50/70)', 'Junior League', 'Senior League',
  'Middle School', 'Freshman', 'Junior Varsity', 'Varsity',
  'College', 'NCAA Division I', 'NCAA Division II', 'NCAA Division III',
  'NAIA', 'Junior College', 'College Club', 'Collegiate Summer',
  'Adult Recreational', 'Adult Competitive', 'Senior / Masters',
  'Independent', 'Minor League', 'Professional', 'Other',
]

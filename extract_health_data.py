#!/usr/bin/env python3
"""
Apple Health Export Extractor
Parses export.xml and creates smaller CSV files for each health metric.
Designed for large files (2GB+) using streaming XML parsing.
"""

import xml.etree.ElementTree as ET
import csv
import os
import sys
from collections import defaultdict
from datetime import datetime

# === CONFIGURATION ===
# Set this to the path of your export.xml file
INPUT_FILE = os.path.expanduser("~/Desktop/export.xml")

# Output folder for CSVs
OUTPUT_DIR = os.path.expanduser("~/Desktop/health_data_csvs")

# Health metrics we want to extract
METRICS_OF_INTEREST = {
    # Heart Rate
    "HKQuantityTypeIdentifierHeartRate": "heart_rate",
    "HKQuantityTypeIdentifierRestingHeartRate": "resting_heart_rate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "heart_rate_variability",
    "HKQuantityTypeIdentifierWalkingHeartRateAverage": "walking_heart_rate_avg",
    
    # Sleep
    "HKCategoryTypeIdentifierSleepAnalysis": "sleep_analysis",
    
    # Steps & Activity
    "HKQuantityTypeIdentifierStepCount": "step_count",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "distance_walking_running",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_energy_burned",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "basal_energy_burned",
    "HKQuantityTypeIdentifierFlightsClimbed": "flights_climbed",
    "HKQuantityTypeIdentifierAppleExerciseTime": "exercise_time",
    "HKQuantityTypeIdentifierAppleStandTime": "stand_time",
    "HKQuantityTypeIdentifierAppleMoveTime": "move_time",
    
    # Body
    "HKQuantityTypeIdentifierBodyMass": "body_mass",
    "HKQuantityTypeIdentifierBodyFatPercentage": "body_fat_percentage",
    
    # Other useful metrics
    "HKQuantityTypeIdentifierOxygenSaturation": "blood_oxygen",
    "HKQuantityTypeIdentifierRespiratoryRate": "respiratory_rate",
    "HKQuantityTypeIdentifierEnvironmentalAudioExposure": "audio_exposure",
}

WORKOUT_TYPE = "Workout"


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"\n❌ ERROR: Could not find export.xml at:")
        print(f"   {INPUT_FILE}")
        print(f"\n   Please either:")
        print(f"   1. Copy your export.xml to your Desktop, OR")
        print(f"   2. Edit this script and change INPUT_FILE to the correct path.")
        sys.exit(1)

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("=" * 60)
    print("  Apple Health Data Extractor")
    print("=" * 60)
    print(f"\n📂 Reading: {INPUT_FILE}")
    print(f"📁 Output:  {OUTPUT_DIR}")
    
    file_size = os.path.getsize(INPUT_FILE)
    print(f"📊 File size: {file_size / (1024**3):.1f} GB")
    print(f"\n⏳ This may take a few minutes for large files...\n")

    # Track counts and open CSV writers
    writers = {}
    files = {}
    counts = defaultdict(int)
    workout_count = 0
    total_records = 0
    workout_rows = []

    # Use iterparse for memory-efficient streaming
    context = ET.iterparse(INPUT_FILE, events=("end",))

    for event, elem in context:
        if elem.tag == "Record":
            record_type = elem.get("type", "")
            
            if record_type in METRICS_OF_INTEREST:
                metric_name = METRICS_OF_INTEREST[record_type]
                
                # Create CSV writer on first encounter
                if metric_name not in writers:
                    filepath = os.path.join(OUTPUT_DIR, f"{metric_name}.csv")
                    f = open(filepath, "w", newline="")
                    files[metric_name] = f
                    
                    if record_type == "HKCategoryTypeIdentifierSleepAnalysis":
                        headers = ["startDate", "endDate", "value", "sourceName", "sourceVersion", "device"]
                    else:
                        headers = ["startDate", "endDate", "value", "unit", "sourceName", "sourceVersion", "device"]
                    
                    writers[metric_name] = csv.DictWriter(f, fieldnames=headers)
                    writers[metric_name].writeheader()
                
                # Write the record
                if record_type == "HKCategoryTypeIdentifierSleepAnalysis":
                    row = {
                        "startDate": elem.get("startDate", ""),
                        "endDate": elem.get("endDate", ""),
                        "value": elem.get("value", "").replace("HKCategoryValueSleepAnalysis", ""),
                        "sourceName": elem.get("sourceName", ""),
                        "sourceVersion": elem.get("sourceVersion", ""),
                        "device": elem.get("device", ""),
                    }
                else:
                    row = {
                        "startDate": elem.get("startDate", ""),
                        "endDate": elem.get("endDate", ""),
                        "value": elem.get("value", ""),
                        "unit": elem.get("unit", ""),
                        "sourceName": elem.get("sourceName", ""),
                        "sourceVersion": elem.get("sourceVersion", ""),
                        "device": elem.get("device", ""),
                    }
                
                writers[metric_name].writerow(row)
                counts[metric_name] += 1
            
            total_records += 1
            if total_records % 500000 == 0:
                print(f"   Processed {total_records:,} records...")
            
            # Free memory
            elem.clear()

        elif elem.tag == "Workout":
            workout_rows.append({
                "workoutActivityType": elem.get("workoutActivityType", "").replace("HKWorkoutActivityType", ""),
                "startDate": elem.get("startDate", ""),
                "endDate": elem.get("endDate", ""),
                "duration": elem.get("duration", ""),
                "durationUnit": elem.get("durationUnit", ""),
                "totalDistance": elem.get("totalDistance", ""),
                "totalDistanceUnit": elem.get("totalDistanceUnit", ""),
                "totalEnergyBurned": elem.get("totalEnergyBurned", ""),
                "totalEnergyBurnedUnit": elem.get("totalEnergyBurnedUnit", ""),
                "sourceName": elem.get("sourceName", ""),
            })
            workout_count += 1
            elem.clear()

    # Write workouts
    if workout_rows:
        filepath = os.path.join(OUTPUT_DIR, "workouts.csv")
        with open(filepath, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=workout_rows[0].keys())
            writer.writeheader()
            writer.writerows(workout_rows)
        counts["workouts"] = workout_count

    # Close all files
    for f in files.values():
        f.close()

    # Print summary
    print(f"\n{'=' * 60}")
    print(f"  ✅ DONE! Processed {total_records:,} total records")
    print(f"{'=' * 60}")
    print(f"\n📁 CSV files saved to: {OUTPUT_DIR}\n")
    
    if counts:
        print(f"{'Metric':<35} {'Records':>10}  {'File'}")
        print(f"{'-'*35} {'-'*10}  {'-'*30}")
        for metric, count in sorted(counts.items(), key=lambda x: -x[1]):
            filename = f"{metric}.csv"
            size = os.path.getsize(os.path.join(OUTPUT_DIR, filename))
            size_str = f"{size/1024:.0f} KB" if size < 1024*1024 else f"{size/(1024*1024):.1f} MB"
            print(f"  {metric:<33} {count:>10,}  {filename} ({size_str})")
    else:
        print("  ⚠️  No matching records found. The file may use different identifiers.")
    
    print(f"\n🎉 Upload the CSV files from your Desktop's 'health_data_csvs' folder")
    print(f"   back to this chat and I'll analyze them for you!\n")


if __name__ == "__main__":
    main()

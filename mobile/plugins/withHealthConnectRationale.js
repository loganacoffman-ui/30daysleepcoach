const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');
const activity = 'com.thirtydaysleepcoach.healthprivacy.HealthPrivacyActivity';
const rationale = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';

// Health Connect's privacy link must work before login, including offline.
module.exports = function withHealthConnectRationale(config) {
  config = withAndroidManifest(config, config => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    main['intent-filter'] = (main['intent-filter'] || []).filter(filter =>
      !(filter.action || []).some(action => action.$['android:name'] === rationale));
    app.activity = (app.activity || []).filter(item => item.$['android:name'] !== activity);
    app.activity.push({ $: { 'android:name': activity, 'android:exported': 'true' },
      'intent-filter': [{ action: [{ $: { 'android:name': rationale } }] }] });
    for (const alias of app['activity-alias'] || []) {
      if (alias.$['android:name'] === 'ViewPermissionUsageActivity') alias.$['android:targetActivity'] = activity;
    }
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/thirtydaysleepcoach/healthprivacy');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'HealthPrivacyActivity.java'), `package com.thirtydaysleepcoach.healthprivacy;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.widget.*;
public class HealthPrivacyActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    int pad = (int)(24 * getResources().getDisplayMetrics().density);
    layout.setPadding(pad, pad, pad, pad);
    TextView text = new TextView(this);
    text.setTextSize(18);
    text.setText("Sleep Coach and Health Connect\\n\\nWith your permission, Sleep Coach reads sleep sessions and stages from Health Connect. We calculate our own Sleep Coach score and upload normalized sleep metrics to your account to personalize coaching and show progress. Raw Health Connect records are not uploaded.\\n\\nWe request read-only Sleep access. We do not write health data or use it for targeted advertising. Sync runs when you open or refresh the app.\\n\\nYou can revoke access in Health Connect, disable sync and remove imported metrics in Sleep Coach Settings, or delete your account. Revoking permission stops future reads; it does not itself remove previously imported metrics.\\n\\nQuestions: logan@30daysleepcoach.com");
    layout.addView(text);
    Button policy = new Button(this);
    policy.setText("Full privacy policy");
    policy.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://30daysleepcoach.com/privacy.html"))));
    layout.addView(policy);
    Button close = new Button(this); close.setText("Done"); close.setOnClickListener(v -> finish()); layout.addView(close);
    ScrollView scroll = new ScrollView(this); scroll.addView(layout); setContentView(scroll);
  }
}
`);
    return config;
  }]);
};

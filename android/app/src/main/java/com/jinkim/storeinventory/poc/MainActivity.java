package com.jinkim.stockly;

import android.content.Intent;
import android.nfc.NfcAdapter;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null
                && NfcAdapter.ACTION_NDEF_DISCOVERED.equals(intent.getAction())
                && intent.getData() != null) {
            intent.setAction(Intent.ACTION_VIEW);
            setIntent(intent);
        }
        super.onNewIntent(intent);
    }
}

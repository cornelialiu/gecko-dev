/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "EMEVideoDecoder.h"
#include "GMPVideoEncodedFrameImpl.h"
#include "mozilla/CDMProxy.h"
#include "MediaData.h"

namespace mozilla {

void
EMEVideoCallbackAdapter::Error(GMPErr aErr)
{
  if (aErr == GMPNoKeyErr) {
    // The GMP failed to decrypt a frame due to not having a key. This can
    // happen if a key expires or a session is closed during playback.
    NS_WARNING("GMP failed to decrypt due to lack of key");
    return;
  }
  VideoCallbackAdapter::Error(aErr);
}

void
EMEVideoDecoder::InitTags(nsTArray<nsCString>& aTags)
{
  aTags.AppendElement(NS_LITERAL_CSTRING("h264"));
  aTags.AppendElement(NS_ConvertUTF16toUTF8(mProxy->KeySystem()));
}

nsCString
EMEVideoDecoder::GetNodeId()
{
  return mProxy->GetNodeId();
}

GMPUniquePtr<GMPVideoEncodedFrame>
EMEVideoDecoder::CreateFrame(MediaRawData* aSample)
{
  GMPUniquePtr<GMPVideoEncodedFrame> frame = GMPVideoDecoder::CreateFrame(aSample);
  if (frame && aSample->mCrypto.mValid) {
    static_cast<gmp::GMPVideoEncodedFrameImpl*>(frame.get())->InitCrypto(aSample->mCrypto);
  }
  return frame;
}

} // namespace mozilla

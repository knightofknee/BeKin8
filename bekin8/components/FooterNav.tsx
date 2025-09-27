import React from 'react';
import { View, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function FooterNav() {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <View style={styles.item}>
        <Button title="Go to Feed" onPress={() => router.push('/feed')} />
      </View>
      <View style={styles.item}>
        <Button title="Friends" onPress={() => router.push('/friends')} />
      </View>
      <View style={styles.item}>
        <Button title="Create Post" onPress={() => router.push('/create-post')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    width: '100%',
    marginTop: 24,
    gap: 24,
  },
  item: {
    width: '60%',
  },
});